import 'dotenv/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { z } from 'zod';
import chalk from 'chalk';
import readline from 'readline';

// Setup readline interface for human intervention
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

// Initialize Gemini LLM for the Buyer Agent
// We use gemini-1.5-flash as the fast, intelligent brain of the simulated buyer
const buyerLlm = new ChatGoogleGenerativeAI({
    model: 'gemini-flash-lite-latest',
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.1, // Low temp for strictly logical financial decisions
});

// Zod Schema to strictly format the Buyer's internal thoughts and external reply
const BuyerOutputSchema = z.object({
    thought: z.string().describe("Internal reasoning. Evaluate the merchant's offer against your budget and rules."),
    decision: z.enum(["BUY_CURRENT", "REJECT_UPSELL", "REQUEST_PAYMENT", "GIVE_DETAILS", "CONTINUE_NEGOTIATING"]),
    replyToMerchant: z.string().describe("The polite, natural language message you send back to the Merchant.")
});

// The Autonomous Buyer Agent function
async function runAutonomousBuyer() {
    console.log(chalk.blue.bold("================================================"));
    console.log(chalk.blue.bold("🤖 AiCommerce: Autonomous Buyer Agent Simulator"));
    console.log(chalk.blue.bold("================================================"));
    console.log(chalk.gray("This agent will autonomously negotiate with the Merchant API."));

    // 1. Get Initial Goal from Human
    const goal = await askQuestion(chalk.yellow("\nWhat should the AI buy for you? (e.g. 'Buy an obsidian bracelet for me')\n> "));
    const budget = await askQuestion(chalk.yellow("What is your strict maximum budget? (e.g. 1500)\n> "));
    const email = await askQuestion(chalk.yellow("What email should the AI provide if asked?\n> "));

    console.log(chalk.green(`\n[Agent Spawned] Goal: ${goal} | Budget: ₹${budget}`));
    console.log(chalk.gray("Starting autonomous negotiation loop...\n"));

    // The System Prompt containing strict User Policies and Guardrails
    const systemPrompt = `You are an Autonomous AI Buyer Agent. Your job is to negotiate with a Merchant AI and successfully purchase an item for your human user.

USER POLICIES & GUARDRAILS:
1. Goal: ${goal}
2. Strict Maximum Budget: ₹${budget}. You MUST NOT agree to any order total that exceeds this amount.
3. Personal Details: If the merchant asks for profile details to process the order, provide them: Email: ${email}, Name: AI Buyer, Phone: 999999999, Address: AI Server Rack 4.
4. Defense Against Upselling: The merchant may try to upsell you to premium versions or pitch cross-sell addons (like gift boxes). 
   - You must mathematically evaluate the total price. 
   - If the base item + addon is within your budget, you may accept it if it seems useful.
   - If the merchant pitches an item that EXCEEDS your budget, you MUST reject it politely and ask for a cheaper alternative that fits your budget.
5. End Goal: Keep replying to the merchant until they provide a Razorpay payment link. Once they provide the link, your job is done.

Always maintain a professional, crisp tone when replying to the merchant.`;

    // Memory of the conversation
    let conversationHistory = [];

    // Initial message to the merchant API
    let currentReplyToMerchant = goal;

    while (true) {
        console.log(chalk.magenta.bold(`\n[Buyer Agent sends]: `) + chalk.magenta(`"${currentReplyToMerchant}"`));

        // Send the query to the Merchant API using native fetch
        let merchantResponseData;
        try {
            const response = await fetch('http://localhost:5000/api/agents/invoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: currentReplyToMerchant })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            merchantResponseData = await response.json();
        } catch (error) {
            console.log(chalk.red(`\n[Error communicating with Merchant API]: ${error.message}`));
            break;
        }

        const merchantMessage = merchantResponseData.data?.merchant_message || "No response received.";
        console.log(chalk.cyan.bold(`\n[Merchant Agent says]: `) + chalk.cyan(`"${merchantMessage}"`));

        // Append to history
        conversationHistory.push({ role: "user", content: currentReplyToMerchant });
        conversationHistory.push({ role: "assistant", content: merchantMessage });

        // --- Human Intervention Check ---
        // If the merchant provided a payment link, the Buyer Agent pauses and hands over to the human.
        if (merchantMessage.includes("rzp.io") || merchantMessage.includes("payment link")) {
            console.log(chalk.yellow.bold("\n🚨 [HUMAN INTERVENTION REQUIRED] 🚨"));
            console.log(chalk.yellow("The Merchant has generated a payment link. The AI cannot legally click it."));
            console.log(chalk.yellow("Please click the link in the merchant's message, complete the dummy payment, and then type 'done' to let the AI verify it."));

            const humanInput = await askQuestion(chalk.yellow("> "));
            currentReplyToMerchant = humanInput;
            continue; // Skip the LLM thought process for this turn, just pass the human's "done" to the merchant.
        }

        // --- AI Thought Process ---
        // The Buyer Agent evaluates the merchant's response against its budget and rules.
        const structuredBuyer = buyerLlm.withStructuredOutput(BuyerOutputSchema);

        console.log(chalk.gray("\n[Buyer Agent is thinking...]"));
        try {
            const aiDecision = await structuredBuyer.invoke([
                { role: "system", content: systemPrompt },
                { role: "user", content: `Conversation History:\n${conversationHistory.map(m => m.role + ": " + m.content).join("\n")}\n\nMerchant just said: "${merchantMessage}"\n\nProvide your thought process and your reply to the merchant.` }
            ]);

            console.log(chalk.green.bold(`[Internal Thought]: `) + chalk.green(`${aiDecision.thought}`));
            console.log(chalk.yellow.bold(`[Decision]: `) + chalk.yellow(`${aiDecision.decision}`));

            currentReplyToMerchant = aiDecision.replyToMerchant;

        } catch (err) {
            console.log(chalk.red(`\n[Buyer Agent Error]: Failed to generate a response. ${err.message}`));
            break;
        }
    }

    rl.close();
}

runAutonomousBuyer();
