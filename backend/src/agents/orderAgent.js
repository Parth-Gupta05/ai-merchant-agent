import { z } from "zod";
import mongoose from "mongoose";
import User from "../models/User.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Addon from "../models/Addon.js";
import { evaluateBestOffer, OfferOutputSchema } from "./offerAgent.js";

// ------------------------------------------------------------------
// 1. Order Agent Input Schema (What the Supervisor sends IN)
// ------------------------------------------------------------------
export const OrderInputSchema = z.object({
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number(),
    addons: z.array(z.string()).optional()
  })).describe("The items the user wants to order."),
  profileData: z.object({
    email: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    address: z.string().nullable().optional()
  }).describe("Current known profile details of the user."),
  orderId: z.string().optional().describe("The ID of the existing order to update.")
});

// ------------------------------------------------------------------
// 2. Order Agent Output Schema (What the Order Agent returns OUT)
// ------------------------------------------------------------------
export const OrderOutputSchema = z.object({
  status: z.enum(["MISSING_EMAIL", "MISSING_PROFILE", "CREATED", "ERROR"]),
  missingFields: z.array(z.string()).optional().describe("Which fields the user still needs to provide."),
  orderId: z.string().optional().describe("The ID of the created temporary order."),
  totalPrice: z.number().optional().describe("The computed total price of the order before discounts."),
  offer: OfferOutputSchema.optional().describe("The best offer applied to this order, if any."),
  message: z.string().describe("Contextual message about what happened.")
});

// ------------------------------------------------------------------
// 3. Agent Execution Logic
// ------------------------------------------------------------------
export const invokeOrderAgent = async (payload) => {
  try {
    const { items, profileData } = payload;

    // We need at least an email to start checking the database
    if (!profileData || !profileData.email) {
      return {
        status: "MISSING_EMAIL",
        missingFields: ["email"],
        message: "We need the user's email address to create or look up their profile."
      };
    }

    // Look up the user in DB
    const email = profileData.email.toLowerCase().trim();
    let dbUser = await User.findOne({ email });

    // Merge incoming profile data with existing DB data (if any)
    const mergedProfile = {
      email,
      name: profileData.name || (dbUser ? dbUser.name : null),
      phone: profileData.phone || (dbUser ? dbUser.phone : null),
      address: profileData.address || (dbUser ? dbUser.address : null)
    };

    // Determine what is still missing
    const missingFields = [];
    if (!mergedProfile.name) missingFields.push("name");
    if (!mergedProfile.phone) missingFields.push("phone");
    if (!mergedProfile.address) missingFields.push("address");

    if (missingFields.length > 0) {
      return {
        status: "MISSING_PROFILE",
        missingFields,
        message: `We found the email, but need the following profile details: ${missingFields.join(", ")}`
      };
    }

    // All data is present! Upsert (Create or Update) the User Profile
    if (!dbUser) {
      dbUser = new User(mergedProfile);
    } else {
      dbUser.name = mergedProfile.name;
      dbUser.phone = mergedProfile.phone;
      dbUser.address = mergedProfile.address;
    }
    await dbUser.save();

    // Resolve string IDs/Names to Mongoose ObjectIds and compute prices
    const resolvedItems = [];
    let computedTotalPrice = 0;

    for (const item of items) {
      let resolvedProductId = item.productId;
      let resolvedProductPrice = 0;

      const prod = await Product.findOne(mongoose.Types.ObjectId.isValid(resolvedProductId)
        ? { _id: resolvedProductId }
        : { $or: [{ name: item.productId }, { productId: item.productId }] }
      );

      if (prod) {
        resolvedProductId = prod._id;
        resolvedProductPrice = prod.price?.amount || 0;
      } else {
        console.warn(`[Order Agent] Could not resolve product: ${item.productId}`);
        continue;
      }

      let itemSubtotal = resolvedProductPrice * (item.quantity || 1);

      const resolvedAddons = [];
      if (item.addons) {
        for (const addonStr of item.addons) {
          let resolvedAddonId = addonStr;
          let resolvedAddonPrice = 0;

          const addonDoc = await Addon.findOne(mongoose.Types.ObjectId.isValid(resolvedAddonId)
            ? { _id: resolvedAddonId }
            : { $or: [{ name: addonStr }, { addonId: addonStr }] }
          );

          if (addonDoc) {
            resolvedAddonId = addonDoc._id;
            resolvedAddonPrice = addonDoc.price?.amount || 0;
          } else {
            console.warn(`[Order Agent] Could not resolve addon: ${addonStr}`);
            continue;
          }

          resolvedAddons.push({
            addonId: resolvedAddonId,
            addonPrice: resolvedAddonPrice
          });

          itemSubtotal += resolvedAddonPrice;
        }
      }

      computedTotalPrice += itemSubtotal;

      resolvedItems.push({
        productId: resolvedProductId,
        quantity: item.quantity || 1,
        productPrice: resolvedProductPrice,
        addons: resolvedAddons
      });
    }

    // Evaluate the best offer using the Offer Agent
    const bestOffer = await evaluateBestOffer({
      totalPrice: computedTotalPrice,
      items: resolvedItems
    });

    let finalTotal = computedTotalPrice;
    let orderUpdateFields = {
      items: resolvedItems,
      totalPrice: computedTotalPrice,
      finalTotal: computedTotalPrice
    };

    if (bestOffer) {
      finalTotal = bestOffer.finaltotal;
      orderUpdateFields = {
        ...orderUpdateFields,
        finalTotal: bestOffer.finaltotal,
        offerType: bestOffer.offertype,
        offerDiscount: bestOffer.offerdiscount,
        discountTotal: bestOffer.discounttotal,
        offerValidity: bestOffer.offervalidity
      };
    }

    // Create or Update the temporary order linked to the user
    let order;
    if (payload.orderId) {
      order = await Order.findByIdAndUpdate(
        payload.orderId,
        orderUpdateFields,
        { new: true }
      );
    }

    if (!order) {
      order = new Order({
        userId: dbUser._id,
        ...orderUpdateFields,
        status: "PENDING_OFFERS" // Even with an offer applied, it waits for final confirmation
      });
      await order.save();
    }

    const responsePayload = {
      status: "CREATED",
      orderId: order._id.toString(),
      totalPrice: computedTotalPrice,
      message: `Profile saved successfully. Order ${payload.orderId ? 'updated' : 'created'} with ID: ${order._id} and is awaiting offers.`
    };

    if (bestOffer) {
      responsePayload.offer = bestOffer;
    }

    return responsePayload;

  } catch (error) {
    console.error("[Order Agent] Error:", error);
    return {
      status: "ERROR",
      message: "An internal error occurred while processing the order."
    };
  }
};
