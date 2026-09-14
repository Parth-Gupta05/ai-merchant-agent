# Merchant Agent Architecture

Based on the provided architecture diagram, the AI-Commerce merchant side will consist of a primary orchestrator (the **Merchant Agent**) and four specialized worker agents. 

## Inter-Agent Communication Protocol
To prevent bloated and confusing JSON structures, **there is no universal schema**. Instead, every pair of communicating agents has its own strictly defined, dedicated Input and Output schemas.
- Example: The Supervisor uses `SupervisorOutputSchema` mapped specifically to `CatalogInputSchema` when talking to the Catalog Agent.
- When building future agents (like the Order Agent and Offer Agent), we will create completely separate, dedicated schemas for their specific communications.

## 1. Merchant Agent (Supervisor)
The top-level orchestrator that interacts directly with the user. It does not perform business logic directly but coordinates the specialized sub-agents. 

**Key Responsibilities & Workflows:**
- **Routing:** Understands the user's intent and routes to the correct sub-agent.
- **Upselling:** When querying products for the user, it defines a price threshold and requests upsell components from the Catalog Agent to show alongside the main products.
- **Cross-selling:** When a user attempts to buy a product, it fetches any `addons` attached to that product from the DB and asks the user if they want to include them.
- **Order Confirmation Flow:** When a user confirms an order, it first consults the **Offer Agent** to find applicable offers, then passes those offers to the **Order Agent** to apply them to the final calculation.

## 2. Catalog Agent
Responsible for product discovery and database interactions.
- Product search & Semantic search
- Product details & Category understanding
- Attribute matching & Availability lookup
- *Handles upsell queries based on thresholds provided by the Merchant Agent.*

## 3. Recommendation Agent
Handles discovery beyond the direct search query.
- When the user asks for "other products like this" or "other products in this category," the Merchant Agent queries this agent.
- It receives the initial products found by the Catalog Agent and recommends alternative or complementary products from the database that differ from the initial set.

## 4. Order Agent
Handles the transactional state and cart management.
- Create cart & Validate items
- Check stock
- Calculate order
- Apply offers (received via the Offer Agent)
- Create order & Update order state
- Return final order information

## 5. Offer Agent
The commercial engine managing pricing rules.
- Discounts & Coupons
- Promotional offers & Offer validity
- Bundle & Campaign pricing
- *Passes applicable promotional data to the Order Agent during checkout.*
