import Product from '../models/Product.js';
import '../models/Addon.js';
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import dotenv from "dotenv";

dotenv.config();

const embeddings = new GoogleGenerativeAIEmbeddings({
  modelName: "gemini-embedding-2",
  apiKey: process.env.GEMINI_API_KEY,
});

export const semanticProductSearch = async (query, constraints = {}) => {
  console.log(`[Catalog Service] Semantic Search: "${query}" constraints:`, constraints);
  try {
    const pipeline = [];
    if (query) {
      const queryVector = await embeddings.embedQuery(query);
      pipeline.push({
        $vectorSearch: {
          index: "vector_index",
          path: "embedding",
          queryVector: queryVector,
          numCandidates: 100,
          limit: 5
        }
      });
    }

    const matchStage = { "inventory.available": true, "inventory.quantity": { $gt: 0 } };
    if (constraints.maxPrice || constraints.minPrice) {
      matchStage["price.amount"] = {};
      if (constraints.maxPrice) matchStage["price.amount"].$lte = constraints.maxPrice;
      if (constraints.minPrice) matchStage["price.amount"].$gt = constraints.minPrice;
    }
    if (constraints.category) matchStage["category"] = constraints.category;

    if (Object.keys(matchStage).length > 0) pipeline.push({ $match: matchStage });

    if (!query) return await Product.find(matchStage).limit(5).lean();

    const products = await Product.aggregate(pipeline);
    return products.map(p => { delete p.embedding; return p; });
  } catch (error) {
    console.error("[Catalog Service] Search Error:", error);
    throw new Error("Failed to search products");
  }
};

export const attributeMatch = async (attributes) => {
  console.log(`[Catalog Service] Attribute Match:`, attributes);
  try {
    const matchStage = {};
    for (const [key, value] of Object.entries(attributes)) {
      matchStage[`attributes.${key}`] = value;
    }
    return await Product.find(matchStage).limit(10).lean();
  } catch (error) {
    console.error("[Catalog Service] Attribute Match Error:", error);
    throw new Error("Failed to match attributes");
  }
};

export const getProductDetails = async (productIds) => {
  console.log(`[Catalog Service] Getting details for: ${productIds}`);
  try {
    return await Product.find({ productId: { $in: productIds } }).populate('addons').lean();
  } catch (error) {
    console.error("[Catalog Service] Get Details Error:", error);
    throw new Error("Failed to get product details");
  }
};

export const checkAvailability = async (productIds) => {
  console.log(`[Catalog Service] Checking availability for: ${productIds}`);
  try {
    const products = await Product.find({ productId: { $in: productIds } }, { productId: 1, inventory: 1 }).lean();
    return products;
  } catch (error) {
    console.error("[Catalog Service] Availability Error:", error);
    throw new Error("Failed to check availability");
  }
};

export const compareProducts = async (productIds) => {
  console.log(`[Catalog Service] Comparing products: ${productIds}`);
  try {
    return await Product.find({ productId: { $in: productIds } }).populate('addons').lean();
  } catch (error) {
    console.error("[Catalog Service] Compare Error:", error);
    throw new Error("Failed to compare products");
  }
};

export const getProductAddons = async (productIds) => {
  console.log(`[Catalog Service] Fetching addons for products: ${productIds}`);
  try {
    const products = await Product.find({ productId: { $in: productIds } }).populate('addons').lean();
    
    // Extract uniquely populated addons
    const allAddons = [];
    const seenIds = new Set();
    
    products.forEach(p => {
      if (p.addons && p.addons.length > 0) {
        p.addons.forEach(addon => {
          if (!seenIds.has(addon.addonId)) {
            seenIds.add(addon.addonId);
            allAddons.push(addon);
          }
        });
      }
    });
    
    return allAddons;
  } catch (error) {
    console.error("[Catalog Service] Get Addons Error:", error);
    throw new Error("Failed to get product addons");
  }
};
