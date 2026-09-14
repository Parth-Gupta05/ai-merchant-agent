import { StateGraph, END, MemorySaver } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import dotenv from "dotenv";
import { invokeCatalogAgent } from "./catalogAgent.js";
import { invokeRecommendationAgent } from "./recommendationAgent.js";
import { invokeOrderAgent } from "./orderAgent.js";
import { invokePaymentAgent } from "./paymentAgent.js";

dotenv.config();

const llm = new ChatGroq({
  model: "openai/gpt-oss-120b",
  apiKey: process.env.GROQ_API_KEY,
  temperature: 0,
});

const plannerllm = new ChatGoogleGenerativeAI({
  model: "gemini-3.7-flash",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});

const responderLlmInstance = new ChatGoogleGenerativeAI({
  model: "gemini-flash-lite-latest",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});

// ------------------------------------------------------------------
// 1. Define the LangGraph State for Plan-and-Execute
// ------------------------------------------------------------------
const agentState = {
  messages: {
    value: (x, y) => x.concat(y),
    default: () => [],
  },
  plan: {
    value: (x, y) => y, // Replaces the current plan on each step
    default: () => [],
  },
  pastSteps: {
    value: (x, y) => {
      if (y === "RESET") return [];
      return x.concat(y);
    },
    default: () => [],
  },
  pendingOrder: {
    value: (x, y) => ({ ...x, ...y, profileData: { ...x?.profileData, ...y?.profileData }, items: y?.items || x?.items || [] }),
    default: () => ({ items: [], profileData: {}, orderId: null })
  },
  finalResponse: {
    value: (x, y) => y,
    default: () => null,
  }
};

// ------------------------------------------------------------------
// 2. Define Schemas
// ------------------------------------------------------------------
const PlannerOutputSchema = z.object({
  plan: z.array(z.object({
    taskDescription: z.string().describe("Natural language description of the task."),
    targetAgent: z.enum(["catalogAgent", "recommendationAgent", "orderAgent", "paymentAgent"]).describe("The agent to execute this task.")
  })).describe("A sequential list of tasks to execute.")
});

const ExecutorOutputSchema = z.object({
  action: z.enum(["SEARCH", "GET_DETAILS", "COMPARE", "CHECK_AVAILABILITY", "INGEST", "GET_ADDONS"]).describe("Action to perform. Use SEARCH if querying products by text. Use CHECK_AVAILABILITY ONLY if you strictly know the exact productId (e.g. BR-001)."),
  searchQuery: z.string().describe("The core item to search."),
  maxPrice: z.number().nullable(),
  minPrice: z.number().nullable(),
  category: z.string().nullable(),
  requestedQuantity: z.number().nullable(),
  targetProductIds: z.array(z.string()).nullable().describe("Only used if action is GET_DETAILS or CHECK_AVAILABILITY.")
});

const ExecutorRecommendationSchema = z.object({
  likedProductName: z.string().nullable().describe("The name of the product the user liked. (e.g. 'obsidian bracelet')"),
  userPreferences: z.string().describe("What the user is looking for (e.g. 'show me more options like this').")
});

const ExecutorOrderSchema = z.object({
  extractedEmail: z.string().nullable().optional().describe("User's email if provided."),
  extractedName: z.string().nullable().optional().describe("User's name if provided."),
  extractedPhone: z.string().nullable().optional().describe("User's phone number if provided."),
  extractedAddress: z.string().nullable().optional().describe("User's physical address if provided."),
  items: z.array(z.object({
    productId: z.string().describe("The core product ID or name."),
    quantity: z.number().nullable().optional().describe("Quantity of the core product. Default to 1."),
    addons: z.array(z.string()).nullable().optional().describe("Any addons (like shipping or packaging) attached to THIS specific product.")
  })).optional().describe("The items the user wants to order.")
});

const ExecutorPaymentSchema = z.object({
  orderId: z.string().describe("The ID of the order to initiate or check payment for."),
  action: z.enum(["GENERATE_LINK", "VERIFY_STATUS"]).describe("Whether to create a link or verify if the user paid.")
});

const workflow = new StateGraph({
  channels: agentState
});

// ------------------------------------------------------------------
// 3. Define Nodes
// ------------------------------------------------------------------

// Node 1: The Planner
workflow.addNode("plannerNode", async (state) => {
  console.log("\n[Supervisor Planner] Assessing user query and creating plan...");
  const lastMessage = state.messages[state.messages.length - 1].content;
  const plannerLlm = plannerllm.withStructuredOutput(PlannerOutputSchema);

  let planObj;
  let attempts = 0;
  while (attempts < 3) {
    try {
      attempts++;
      console.time(`[Supervisor Planner] LLM Call (Attempt ${attempts})`);
      planObj = await plannerLlm.invoke([
        {
          role: "system",
          content: `You are the Merchant Supervisor Planner. Your strict mandate is to analyze the user's request and the entire conversation history, then break it down into a precise sequence of tasks targeting specific agents. You must strictly adhere to the rules and never invent agents or tasks that violate these constraints.

Follow these steps to create your task list:
1. Check the user query.
2. Check the entire conversation history with the user.
3. Create a list of tasks in chronological order so the supervisor can run it to complete the operation the user has asked for.
4. For creating the task, check if the task can be done by a basic template.
   - If YES, then do it.
   - If NO, then create a list of tasks that has to be done for achieving the goal.
5. In both cases, look at all functions each agent can do and use that ability to target an agent to give a response for a particular task.

--- STRICT RULES ---
CRITICAL UPSELL LOGIC (Budget Constraints):
- TRIGGER: The user searches for products with a strict maximum budget (e.g., "powerbanks under 1000rs").
- ACTION: You MUST create exactly TWO tasks in this order:
  1. A task to search the catalog for the exact requested products under the specified budget. (Target Agent: catalogAgent)
  2. An UPSELL task to search the catalog for premium alternatives where minPrice = user's maximum budget, and maxPrice = ~50% more than their budget. (Target Agent: catalogAgent). 
- CONSTRAINT: DO NOT use the recommendationAgent for upselling.

CRITICAL RECOMMENDATION LOGIC (Similar Products):
- TRIGGER: The user explicitly asks for recommendations or alternatives based on a product they liked (e.g., "I liked the obsidian bracelet, show me more like it").
- ACTION: You MUST create exactly TWO tasks in this order:
  1. A general search to fetch products from the same broad category. (Target Agent: catalogAgent)
  2. A recommendation task to filter the fetched products and suggest relevant alternatives. (Target Agent: recommendationAgent)

CRITICAL ORDER LOGIC (Purchase & Cross-Sell):
- TRIGGER A (Initial Purchase Intent): The user expresses intent to buy a product for the first time (e.g., "I want to buy the obsidian bracelet", "I want 30 of them").
- ACTION A: You MUST create exactly ONE task to fetch addons for that product so they can be pitched to the user. (Target Agent: catalogAgent). 
- CONSTRAINT A: NEVER route to the orderAgent immediately upon initial purchase intent. Addons MUST be fetched first.

- TRIGGER B (Addon Response / Profile Collection): The user is directly responding to an addon pitch (e.g., "Yes, add the gift box", "yes place the order", "No, just the bracelet") OR is providing profile details for an ongoing order (e.g., "my email is x@y.com").
- ACTION B: You MUST create exactly ONE task to process the order and save the user's profile. (Target Agent: orderAgent)

CRITICAL PAYMENT LOGIC:
- TRIGGER C (Initiate Payment): The user has just successfully created an order and they agree to initiate payment (e.g., "yes initiate payment", "generate link").
- ACTION C: You MUST create exactly ONE task to generate a payment link for the active order. (Target Agent: paymentAgent)
- TRIGGER D (Verify Payment): The user states they have completed the payment (e.g., "I paid", "done").
- ACTION D: You MUST create exactly ONE task to verify the payment status of the active order. (Target Agent: paymentAgent)

DEFAULT LOGIC:
- If the user's request does not trigger the Upsell, Recommendation, or Order rules above, simply create 1 standard task targeting the appropriate agent (e.g., a simple catalog search).

--- AVAILABLE AGENT ABILITIES ---
Catalog Agent:
- SEARCH: Takes a semantic search term and optional constraints (minPrice, maxPrice, category); returns a list of matching products with their names, prices, and stock status.
- GET_DETAILS: Takes an array of exact product IDs; returns detailed product information.
- COMPARE: Takes an array of at least two product IDs; returns the detailed products along with an AI-generated comparison summary.
- CHECK_AVAILABILITY: Takes an array of exact product IDs; returns the products with their current available stock quantities.
- GET_ADDONS: Takes an array of product IDs (or a fallback search query); returns a list of related cross-sell addons (with name, price, description) available for those products.

Recommendation Agent:
- GET_RECOMMENDATIONS: Takes the name of a product the user liked, their specific preferences, and a raw list of available products; returns a filtered list of recommended alternative products with an explanation of why they were recommended.

Order Agent:
- PROCESS_ORDER: Takes an array of items (product IDs/addon IDs and quantities) and known user profile data (email, name, phone, address); returns the current order status (MISSING_EMAIL, MISSING_PROFILE, or CREATED), identifying any missing fields that must be collected before the order is saved in the database.

Payment Agent:
- GENERATE_LINK: Takes an orderId, generates a Razorpay payment link, and returns it.
- VERIFY_STATUS: Takes an orderId, checks the database, and returns the current payment status (COMPLETED, PENDING, FAILED).

--- BASIC TEMPLATES ---
Template 1: Product Search & Upsell
userinput: "hii, i would like a powerbank and my budget is 1000rs"
taskslist: [
  {
    "taskDescription": "Search the catalog for powerbanks under 1000rs",
    "targetAgent": "catalogAgent"
  },
  {
    "taskDescription": "Search the catalog for premium powerbank alternatives between 1000rs and 1500rs for upsell",
    "targetAgent": "catalogAgent"
  }
]

Template 2: First-Time Intent to Buy (Must Fetch Addons First)
userinput: "so i want 1299 rs powerbank which u told and i want 10 pieces can i get them?"
taskslist: [
  {
    "taskDescription": "Fetch addons for the 1299 rs powerbank so they can be pitched to the user.",
    "targetAgent": "catalogAgent"
  }
]

Template 3: Responding to Addon Pitch (Proceeding to Order)
userinput: "yes do it"
taskslist: [
  {
    "taskDescription": "Process the order for 10 units of the 1299 rs powerbank and include the selected addons.",
    "targetAgent": "orderAgent"
  }
]

Template 4: Providing Profile Details for an Ongoing Order
userinput: "parthgupta20052005@gmail.com"
taskslist: [
  {
    "taskDescription": "Update and process the existing order with the provided email address parthgupta20052005@gmail.com",
    "targetAgent": "orderAgent"
  }
]

--- COMPLEX TASK COMPOSITION ---
If there is a task long enough to encorporate 2 or more template tasks, you should take reference to the templates to create the entire long tasks so that it can complete the goal. Combine the necessary tasks into a single cohesive sequence.
`
        },
        {
          role: "user",
          content: `Entire Chat History:\n${state.messages.map(m => m.role + ": " + m.content).join("\n")}\n\nCurrent User Query:\n${lastMessage}`
        }
      ]);
      console.timeEnd(`[Supervisor Planner] LLM Call (Attempt ${attempts})`);
      break;
    } catch (err) {
      console.warn(`[Supervisor Planner] Retry ${attempts}/3:`, err.message);
      if (attempts >= 3) throw new Error("Planner failed");
    }
  }

  console.log(`[Supervisor Planner] Generated Plan:`, JSON.stringify(planObj.plan, null, 2));
  return { plan: planObj.plan, pastSteps: "RESET" };
});

// Node 2: The Executor
workflow.addNode("executorNode", async (state) => {
  const currentTask = state.plan[0];
  console.log(`\n[Supervisor Executor] Executing Task: "${currentTask.taskDescription}"`);

  if (currentTask.targetAgent === "catalogAgent") {
    const executorLlm = llm.withStructuredOutput(ExecutorOutputSchema);
    let taskFormat;
    let attempts = 0;
    while (attempts < 3) {
      try {
        attempts++;
        console.time(`[Supervisor Executor - Catalog] LLM Call (Attempt ${attempts})`);
        taskFormat = await executorLlm.invoke([
          {
            role: "system",
            content: `Format the following task into strict parameters for the Catalog Agent. 
                    Extract exact numbers for minPrice, maxPrice, and requestedQuantity if they exist.

                    CRITICAL RULES FOR CONSTRAINTS (minPrice, maxPrice, requestedQuantity):
                    - You MUST extract these constraints STRICTLY from the "Task:" description! 
                    - IGNORE constraints in the Chat History. If the chat says "under 1000" but the Task says "between 1000 and 1500", you MUST extract minPrice: 1000 and maxPrice: 1500. The Task is the absolute source of truth!
                    
                    CRITICAL RULES FOR searchQuery:
                    - Keep it strictly to the core physical item name (e.g., 'bracelets').
                    - Do NOT include numbers, prices, or words like 'premium', 'alternative', or 'upsell'. These words will pollute and break the vector search!
                    
                    CRITICAL RULES FOR category:
                    - Do NOT extract a 'category' unless you know the exact strict database category ID. For general item searches (like 'bracelets'), leave category as null! Let the semantic search handle it.`
          },
          {
            role: "user",
            content: `Task: ${currentTask.taskDescription}\n\nEntire Chat History:\n${state.messages.map(m => m.role + ": " + m.content).join("\n")}\n\nCurrent User Query:\n${state.messages[state.messages.length - 1].content}`
          }
        ]);
        console.timeEnd(`[Supervisor Executor - Catalog] LLM Call (Attempt ${attempts})`);
        break;
      } catch (err) {
        console.warn(`[Supervisor Executor] Retry ${attempts}/3:`, err.message);
        if (attempts >= 3) throw new Error("Executor mapping failed");
      }
    }

    let catalogPayload = {
      action: taskFormat.action,
      query: taskFormat.searchQuery,
      constraints: {}
    };
    if (taskFormat.maxPrice !== null) catalogPayload.constraints.maxPrice = taskFormat.maxPrice;
    if (taskFormat.minPrice !== null) catalogPayload.constraints.minPrice = taskFormat.minPrice;
    if (taskFormat.category !== null) catalogPayload.constraints.category = taskFormat.category;
    if (taskFormat.requestedQuantity !== null) catalogPayload.constraints.requestedQuantity = taskFormat.requestedQuantity;
    if (taskFormat.targetProductIds && taskFormat.targetProductIds.length > 0) catalogPayload.targetProductIds = taskFormat.targetProductIds;

    console.log(`[Supervisor Executor -> Catalog Agent] Payload:`, JSON.stringify(catalogPayload));

    // Call the actual Catalog Agent
    const result = await invokeCatalogAgent(catalogPayload);

    // Pop the executed task from the plan
    const newPlan = state.plan.slice(1);

    return {
      pastSteps: [{ task: currentTask.taskDescription, result: result }],
      plan: newPlan
    };
  } else if (currentTask.targetAgent === "recommendationAgent") {
    const executorRecLlm = llm.withStructuredOutput(ExecutorRecommendationSchema);
    let recFormat;
    let attempts = 0;
    while (attempts < 3) {
      try {
        attempts++;
        console.time(`[Supervisor Executor - Rec] LLM Call (Attempt ${attempts})`);
        recFormat = await executorRecLlm.invoke([
          {
            role: "system",
            content: `Format the recommendation task into strict parameters. Extract the product they liked and their general preferences.`
          },
          {
            role: "user",
            content: `Task: ${currentTask.taskDescription}\n\nEntire Chat History:\n${state.messages.map(m => m.role + ": " + m.content).join("\n")}\n\nCurrent User Query:\n${state.messages[state.messages.length - 1].content}`
          }
        ]);
        console.timeEnd(`[Supervisor Executor - Rec] LLM Call (Attempt ${attempts})`);
        break;
      } catch (err) {
        console.warn(`[Supervisor Executor - Rec] Retry ${attempts}/3:`, err.message);
        if (attempts >= 3) throw new Error("Executor mapping failed for recommendation");
      }
    }

    // Extract available products from the Catalog Agent's previous step
    let availableProducts = [];
    if (state.pastSteps.length > 0) {
      const lastResult = state.pastSteps[state.pastSteps.length - 1].result;
      if (lastResult && lastResult.products) {
        availableProducts = lastResult.products;
      }
    }

    let recPayload = {
      likedProductName: recFormat.likedProductName,
      userPreferences: recFormat.userPreferences,
      availableProducts: availableProducts
    };

    console.log(`[Supervisor Executor -> Recommendation Agent] Payload:`, JSON.stringify({ likedProductName: recPayload.likedProductName, userPreferences: recPayload.userPreferences }));

    const result = await invokeRecommendationAgent(recPayload);
    const newPlan = state.plan.slice(1);

    return {
      pastSteps: [{ task: currentTask.taskDescription, result: result }],
      plan: newPlan
    };
  } else if (currentTask.targetAgent === "orderAgent") {
    const executorOrderLlm = llm.withStructuredOutput(ExecutorOrderSchema);
    let orderFormat;
    let attempts = 0;
    while (attempts < 3) {
      try {
        attempts++;
        console.time(`[Supervisor Executor - Order] LLM Call (Attempt ${attempts})`);
        orderFormat = await executorOrderLlm.invoke([
          {
            role: "system",
            content: `Format the order task into strict parameters. Extract any profile information from the conversation. 
                CRITICAL INSTRUCTION FOR ITEMS: 
                1. You MUST extract ALL products and quantities explicitly mentioned in the "Task:" description.
                2. If an addon is mentioned in the Task (e.g., 'Priority Express Shipping'), you MUST put its name inside the 'addons' array of the product it belongs to! Do NOT leave the 'addons' array empty if an addon is mentioned.
                3. If the user is implicitly confirming an addon pitched by the Merchant (e.g., they just say "yes"), resolve it using the Merchant's previous message and extract that addon name into the 'addons' array!
                4. DO NOT hallucinate products that are not mentioned in the Task or the current implicit confirmation.`
          },
          {
            role: "user",
            content: `Task: ${currentTask.taskDescription}\n\nEntire Chat History:\n${state.messages.map(m => m.role + ": " + m.content).join("\n")}\n\nCurrent User Query:\n${state.messages[state.messages.length - 1].content}`
          }
        ]);
        console.timeEnd(`[Supervisor Executor - Order] LLM Call (Attempt ${attempts})`);
        break;
      } catch (err) {
        console.warn(`[Supervisor Executor - Order] Retry ${attempts}/3:`, err.message);
        if (attempts >= 3) throw new Error("Executor mapping failed for order");
      }
    }

    // Prepare pending order items
    let newItems = [];
    if (orderFormat.items) {
      for (let item of orderFormat.items) {
        newItems.push({
          productId: item.productId,
          quantity: item.quantity || 1,
          addons: item.addons || []
        });
      }
    }

    // Smart merge into state.pendingOrder
    let mergedItems = [...(state.pendingOrder.items || [])];
    for (let newItem of newItems) {
      const existingIdx = mergedItems.findIndex(i => i.productId === newItem.productId);
      if (existingIdx >= 0) {
        mergedItems[existingIdx].quantity = newItem.quantity;
        // Merge addons (avoid duplicates)
        const existingAddons = mergedItems[existingIdx].addons || [];
        const combinedAddons = new Set([...existingAddons, ...newItem.addons]);
        mergedItems[existingIdx].addons = Array.from(combinedAddons);
      } else {
        mergedItems.push(newItem);
      }
    }

    const newPendingOrderUpdate = {
      orderId: state.pendingOrder.orderId,
      items: mergedItems,
      profileData: {
        email: orderFormat.extractedEmail || state.pendingOrder.profileData?.email,
        name: orderFormat.extractedName || state.pendingOrder.profileData?.name,
        phone: orderFormat.extractedPhone || state.pendingOrder.profileData?.phone,
        address: orderFormat.extractedAddress || state.pendingOrder.profileData?.address,
      }
    };

    console.log(`[Supervisor Executor -> Order Agent] Payload:`, JSON.stringify(newPendingOrderUpdate));
    const result = await invokeOrderAgent(newPendingOrderUpdate);

    if (result.orderId) {
      newPendingOrderUpdate.orderId = result.orderId;
    }

    const newPlan = state.plan.slice(1);

    return {
      pastSteps: [{ task: currentTask.taskDescription, result: result }],
      plan: newPlan,
      pendingOrder: newPendingOrderUpdate // Save memory back to LangGraph
    };
  } else if (currentTask.targetAgent === "paymentAgent") {
    const executorPaymentLlm = llm.withStructuredOutput(ExecutorPaymentSchema);
    let payFormat;
    let attempts = 0;
    while (attempts < 3) {
      try {
        attempts++;
        console.time(`[Supervisor Executor - Payment] LLM Call (Attempt ${attempts})`);
        payFormat = await executorPaymentLlm.invoke([
          {
            role: "system",
            content: `Format the payment task into strict parameters. Extract the active order ID from the chat history if not explicitly stated.`
          },
          {
            role: "user",
            content: `Task: ${currentTask.taskDescription}\n\nEntire Chat History:\n${state.messages.map(m => m.role + ": " + m.content).join("\n")}\n\nCurrent User Query:\n${state.messages[state.messages.length - 1].content}`
          }
        ]);
        console.timeEnd(`[Supervisor Executor - Payment] LLM Call (Attempt ${attempts})`);
        break;
      } catch (err) {
        console.warn(`[Supervisor Executor - Payment] Retry ${attempts}/3:`, err.message);
        if (attempts >= 3) throw new Error("Executor mapping failed for payment");
      }
    }

    // Default to the pending order ID if the LLM couldn't extract it but we have one in memory
    if (!payFormat.orderId && state.pendingOrder.orderId) {
      payFormat.orderId = state.pendingOrder.orderId;
    }

    console.log(`[Supervisor Executor -> Payment Agent] Payload:`, JSON.stringify(payFormat));
    const result = await invokePaymentAgent(payFormat);

    return {
      pastSteps: [{ task: currentTask.taskDescription, result: result }],
      plan: state.plan.slice(1)
    };
  } else {
    // Fallback for other stubbed agents
    console.log(`[Supervisor Executor] Agent ${currentTask.targetAgent} not fully implemented yet.`);
    const newPlan = state.plan.slice(1);
    return {
      pastSteps: [{ task: currentTask.taskDescription, result: { status: "STUB", message: "Not implemented" } }],
      plan: newPlan
    };
  }
});

// Node 3: The Merchant Responder
workflow.addNode("merchantResponder", async (state) => {
  console.log("\n[Merchant Responder] Synthesizing all step results into final response...");
  const pastSteps = state.pastSteps;

  const responderLlm = responderLlmInstance.withStructuredOutput(z.object({
    natural_language_response: z.string().describe("A conversational response.")
  }));

  let nlgResult;
  let attempts = 0;
  while (attempts < 3) {
    try {
      attempts++;
      console.time(`[Merchant Responder] LLM Call (Attempt ${attempts})`);
      nlgResult = await responderLlm.invoke([
        {
          role: "system",
          content: `You are the Merchant Agent communicating with the user. Look at all the tasks executed and their results. 
            Draft a final, polite response to the user.
            
            TONE AND STYLE:
            - Keep responses crisp, on-point, and professional. 
            - DO NOT use any emojis.

            STRICT CONTEXT BOUNDARIES:
            - ONLY pitch upsells or addons if they EXPLICITLY appear in the 'Tasks and Results' array provided for this exact turn. 
            - DO NOT blindly repeat pitches or offers that exist in the past Chat History unless specifically requested.
            - If the current task is simply confirming order creation (status: CREATED), just politely confirm the order ID and ask if they need anything else. Do NOT append upsell pitches to order confirmations.
            
            CRITICAL INSTRUCTIONS:
            - Summarize the main products found that exactly matched their query.
            - If an UPSELL task was executed this turn and found premium items (products with a higher price range), smoothly pitch them! (e.g. "If you're willing to stretch your budget slightly, we also have X...").
            - If they asked for a quantity, verify stock.
            - If the Catalog Agent returned an 'addons' array (from a GET_ADDONS task) this turn, politely pitch these cross-sell addons to the user before they check out!
            - If the Order Agent returned a status of MISSING_EMAIL or MISSING_PROFILE, politely ask the user for exactly the missing fields required to create their profile and process their order.
            - If the Order Agent returned CREATED, concisely confirm their order creation AND explicitly ask if they would like to initiate payment. Do NOT append upsell pitches to order confirmations.
            - If the Payment Agent returned a LINK_GENERATED status, provide the user with the paymentLink and ask them to click it, pay, and say 'I paid' once they are finished.
            - If the Payment Agent returned a VERIFY_STATUS result as COMPLETED, enthusiastically confirm that their order is fully paid and confirmed!
            - Do not output raw JSON.`
        },
        {
          role: "user",
          content: `Entire Chat History:\n${state.messages.map(m => m.role + ": " + m.content).join("\n")}\n\nTasks and Results: ${JSON.stringify(pastSteps)}`
        }
      ]);
      console.timeEnd(`[Merchant Responder] LLM Call (Attempt ${attempts})`);
      break;
    } catch (err) {
      console.warn(`[Merchant Responder] Retry ${attempts}/3:`, err.message);
      if (attempts >= 3) {
        nlgResult = { natural_language_response: "I found some results, but had trouble formatting my response." };
      }
    }
  }

  // Filter raw data: If a recommendation task ran, hide the intermediate broad catalog search 
  // and only return the final recommended products to the user.
  let executionDataToReturn = pastSteps;
  const recommendationStep = pastSteps.find(step => step.result && step.result.recommendedProducts);

  if (recommendationStep) {
    executionDataToReturn = [recommendationStep];
  }

  return {
    messages: [{ role: "assistant", content: nlgResult.natural_language_response }],
    finalResponse: {
      merchant_message: nlgResult.natural_language_response,
      raw_execution_data: executionDataToReturn
    }
  };
});

// ------------------------------------------------------------------
// 4. Edges & Looping Logic
// ------------------------------------------------------------------
const shouldContinue = (state) => {
  if (state.plan && state.plan.length > 0) {
    return "executorNode"; // Loop back to executor
  }
  return "merchantResponder"; // Loop broken, plan finished
};

workflow.addEdge("plannerNode", "executorNode");

workflow.addConditionalEdges("executorNode", shouldContinue, {
  executorNode: "executorNode",
  merchantResponder: "merchantResponder"
});

workflow.addEdge("merchantResponder", END);

workflow.setEntryPoint("plannerNode");

const checkpointer = new MemorySaver();
export const supervisorGraph = workflow.compile({ checkpointer });

export const invokeSupervisor = async (query, threadId = "default-thread") => {
  const config = { configurable: { thread_id: threadId } };

  // To kick off the graph, we just push the user's message to the messages array.
  // The MemorySaver handles preserving the past state.
  const result = await supervisorGraph.invoke({
    messages: [{ role: "user", content: query }],
  }, config);

  return result.finalResponse || { message: "No response generated." };
};
