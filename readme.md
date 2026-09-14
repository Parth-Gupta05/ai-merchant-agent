# AiCommerce: Agentic Backend Architecture

AiCommerce is an intelligent, agent-driven backend architecture that transforms a standard commerce system into an autonomous, conversational sales engine. 

Instead of relying on rigid API endpoints or simple chatbots, this project utilizes a **Supervisor-Subagent Architecture** (powered by LangChain and LangGraph). Specialized AI agents collaborate seamlessly to manage the entire commerce lifecycle—from product discovery and dynamic offer calculation, all the way to secure checkout.

---

## 🌟 Key Commercial Features

This architecture is built strictly from a merchant's perspective to maximize average order value and conversion rates autonomously:

- **Intelligent Upselling:** When a user searches for a product with a specific budget, the AI proactively searches for premium, higher-tier alternatives just slightly above the budget to naturally upsell the customer.
- **Contextual Cross-selling (Add-ons):** When a user decides to buy a product, the AI automatically fetches associated add-ons from the database (e.g., premium gift packaging for a bracelet) and pitches them before checkout.
- **Dynamic Discount Engine:** A dedicated Offer Agent mathematically evaluates the user's cart against all active database campaigns to apply the best possible deal. It supports:
  - **Coupons (Fixed/Percentage discounts)**
  - **Promotional Offers**
  - **Bundle Pricing**
  - **Campaign Pricing & Offer Validity Checking**
- **Smart Recommendations:** If a user wants to explore alternatives, a dedicated agent filters catalog results based on the user's specific preferences, providing highly personalized recommendations with reasoning.

---

## 🧠 Architecture Overview

The system is orchestrated by a central **Merchant Agent (Supervisor)** that delegates specialized tasks to a fleet of expert subagents.

### 1. The Merchant Agent (The Orchestrator)
The Supervisor acts as the brain of the operation and uses a robust **Plan-and-Execute** workflow.
- **The Planner:** Analyzes the user's natural language input, reviews the conversation history, and breaks the user's intent down into a strict JSON array of executable tasks.
- **The Executor:** Routes each task to the appropriate Subagent, providing them with the exact structured payload they need.
- **The Responder:** Once all tasks are completed, this node synthesizes the raw JSON results from the subagents back into a polite, conversational response for the user.

### 2. The Subagents (The Experts)

#### 📦 Catalog Agent
Handles all interactions with the core product database.
- Semantic & Attribute Search
- Product Details & Category Understanding
- Availability (Stock) Lookup

#### 🎯 Recommendation Agent
Takes user preferences (e.g., budget, specific needs) and a list of available products from the Catalog Agent to suggest highly personalized alternative items.

#### 💰 Offer Agent
The financial engine. It evaluates the user's cart total against all active database offers (Coupons, Promos, Bundles, Campaigns) to dynamically apply the absolute best possible discount for the user.

#### 🛒 Order Agent
Manages the checkout state and handles **User Profile Creation**.
- **Profile Validation:** Checks if the user exists in the database. If not, it halts the order process and explicitly asks the user for missing profile details (Email, Name, Phone, Address).
- Validates items and checks final stock
- Creates the cart and calculates the base order total
- Calls the Offer Agent to apply discounts
- Creates and updates the final order state in MongoDB once the profile is complete
- Returns the final order information for payment processing

#### 💳 Payment Agent
Integrates directly with Razorpay to generate secure payment links based on the final computed order total, and verifies payment completion statuses once the user has paid.

---

## 🚀 How It Works (The Execution Flow)

1. **User Input:** The user sends a conversational message to `/api/agents/invoke` (e.g., *"I want to buy a powerbank and my budget is ₹1500"*).
2. **Planning Phase:** The Supervisor Planner detects the intent and generates an execution plan (e.g., Target: Catalog Agent -> Search for powerbanks under ₹1500; Target: Catalog Agent -> Search for premium powerbanks up to ₹2000 for upselling).
3. **Execution Phase:** The Supervisor Executor parses the tasks and invokes the Subagents with the exact JSON constraints.
4. **Synthesis:** The Merchant Responder receives the raw product data and replies to the user naturally, including the base product and the upsell pitch.

## 🛠 Tech Stack
- **Node.js / Express:** Backend API framework.
- **MongoDB / Mongoose:** Database for Products, Orders, Users, Offers, and Addons.
- **LangChain & LangGraph:** For agent orchestration, pregel graphs, and state management.
- **Google Gemini & Groq:** Powerful LLMs powering the Planner, Executor, and Responder nodes.
- **Zod:** For strict JSON schema validation and structured LLM output parsing.
- **Razorpay:** For test-mode payment gateway integration.

---

## ⚡ LLM Load Balancing & Resilience
To prevent API rate limits from exhausting mid-transaction and halting the purchase flow, this architecture utilizes **Model Load Balancing**. 

Different LLMs are mapped to different nodes based on their strengths:
- **Planner Node:** Uses `gemini-3.7-flash` for complex reasoning and breaking down conversational intent.
- **Executor Node:** Uses Groq (`llama3-70b-8192` or similar) for blazing-fast, JSON-strict tool calling and task execution.
- **Responder Node:** Uses `gemini-flash-lite-latest` for low-latency, conversational synthesis.

This distributed approach ensures that no single API hits a rate-limit ceiling during heavy user traffic. Developers can easily swap out these models in the agent initialization files (`supervisorAgent.js`) depending on their preferred providers and quota limits.

---

## 🏃 How to Run Locally

Follow these steps to spin up the Merchant Agent on your local machine:

### 1. Backend Setup
1. Open your terminal and navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install the required dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables by renaming the sample file and filling in your API keys:
   ```bash
   cp .env.sample .env
   ```
4. Seed the MongoDB database with initial Products, Addons, and Offers:
   ```bash
   node seed.js
   ```
5. Start the Express server:
   ```bash
   npm start
   # or node server.js
   ```
The Merchant API will now be listening on `http://localhost:5000`.

### 2. Testing the Agent
You can test the agent using tools like Postman or cURL by sending a POST request:

**Endpoint:** `POST http://localhost:5000/api/agents/invoke`

**Request Body (JSON):**
```json
{
  "query": "I want to buy an obsidian bracelet. My budget is ₹1500."
}
```
