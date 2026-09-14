import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";

dotenv.config();

// ------------------------------------------------------------------
// 1. Define Input and Output Schemas
// ------------------------------------------------------------------

export const RecommendationInputSchema = z.object({
  likedProductName: z.string().nullable().describe("The name or ID of the product the user liked. Used to filter it out."),
  userPreferences: z.string().describe("What the user is looking for (e.g. 'similar style', 'different color')."),
  availableProducts: z.array(z.any()).describe("The raw array of products fetched by the Catalog Agent.")
});

export const RecommendationOutputSchema = z.object({
  status: z.enum(["SUCCESS", "NO_RECOMMENDATIONS", "ERROR"]),
  recommendedProducts: z.array(z.object({
    productId: z.string(),
    name: z.string(),
    price: z.number(),
    in_stock: z.boolean(),
    recommendation_reason: z.string().describe("Why this product is being recommended as an alternative.")
  })),
  message: z.string()
});

// ------------------------------------------------------------------
// 2. Initialize Model
// ------------------------------------------------------------------

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-flash-lite-latest",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});

// ------------------------------------------------------------------
// 3. Execution Logic
// ------------------------------------------------------------------

export const invokeRecommendationAgent = async (inputData) => {
  try {
    console.log("\n--- Recommendation Agent Invoked ---");
    const parsedInput = RecommendationInputSchema.parse(inputData);

    // Quick validation: If no available products were passed, we can't recommend anything.
    if (!parsedInput.availableProducts || parsedInput.availableProducts.length === 0) {
      console.log("[Recommendation Agent] No available products provided by previous step.");
      return {
        status: "NO_RECOMMENDATIONS",
        recommendedProducts: [],
        message: "No products were found in the catalog to recommend from."
      };
    }

    const recommenderLLM = llm.withStructuredOutput(RecommendationOutputSchema);

    let finalResponse;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        finalResponse = await recommenderLLM.invoke([
          {
            role: "system",
            content: `You are the Recommendation Agent. You do NOT query the database.
            Instead, you receive a list of 'availableProducts' that were already fetched from the database by the Catalog Agent.
            
            CRITICAL RULES:
            1. Look at 'likedProductName'. If it exists, you MUST REMOVE that exact product from the recommendations. Never recommend the exact same thing they already liked.
            2. Analyze 'userPreferences' and select the 2 or 3 best matching products from the 'availableProducts' list.
            3. Provide a highly personalized 'recommendation_reason' for each selected product explaining why it is a great alternative.
            4. Return ONLY products that actually exist in the provided 'availableProducts' array. Do not invent products.`
          },
          {
            role: "user",
            content: JSON.stringify({
              likedProductName: parsedInput.likedProductName,
              userPreferences: parsedInput.userPreferences,
              availableProducts: parsedInput.availableProducts
            })
          }
        ]);
        break; // Success
      } catch (err) {
        console.warn(`[Recommendation Agent] LLM failed (Attempt ${attempts}/${maxAttempts}):`, err.message);
        if (attempts >= maxAttempts) {
          throw new Error(`LLM Recommendation failed after 3 attempts: ${err.message}`);
        }
      }
    }

    console.log("--- Recommendation Agent Finished ---");
    return finalResponse;

  } catch (error) {
    console.error("Recommendation Agent Error:", error.message);
    return {
      status: "ERROR",
      recommendedProducts: [],
      message: error.message
    };
  }
};
