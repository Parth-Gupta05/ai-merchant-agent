import Coupon from "../models/Coupon.js";
import PromotionalOffer from "../models/PromotionalOffer.js";
import Campaign from "../models/Campaign.js";
import { z } from "zod";

export const OfferInputSchema = z.object({
  totalPrice: z.number().describe("The total price of the order before discounts."),
  items: z.array(z.object({
    quantity: z.number().optional().default(1),
    productPrice: z.number().optional().default(0)
  })).describe("The items in the order.")
});

export const OfferOutputSchema = z.object({
  offertype: z.enum(["Coupon", "Promotional", "Bundle", "Campaign"]),
  offerdiscount: z.string().describe("Description of the winning offer"),
  discounttotal: z.number(),
  finaltotal: z.number(),
  offervalidity: z.date().nullable().optional()
});

/**
 * Standalone Offer Agent.
 * Evaluates all active offers against the given order data and returns the one with the maximum discount.
 * 
 * @param {Object} orderData - The order data object.
 * @param {Number} orderData.totalPrice - The calculated total price of the order.
 * @param {Array} orderData.items - The items in the order.
 * @returns {Object|null} The best offer, or null if no offers apply.
 */
export const evaluateBestOffer = async (orderData) => {
  const { totalPrice, items } = orderData;

  if (!totalPrice || totalPrice <= 0) {
    return null;
  }

  // Calculate total product price strictly (excluding addons) for bundle logic
  let totalProductPrice = 0;
  let totalProductsCount = 0;

  if (items && Array.isArray(items)) {
    for (const item of items) {
      totalProductsCount += (item.quantity || 1);
      totalProductPrice += ((item.productPrice || 0) * (item.quantity || 1));
    }
  }

  const potentialOffers = [];
  const now = new Date();

  // 1. Evaluate Coupons
  const activeCoupons = await Coupon.find({ isActive: true, validUntil: { $gt: now } });
  for (const coupon of activeCoupons) {
    if (totalPrice >= coupon.minOrderValue) {
      let discountAmount = 0;
      if (coupon.discountType === 'PERCENTAGE') {
        discountAmount = totalPrice * (coupon.discountValue / 100);
      } else if (coupon.discountType === 'FIXED') {
        discountAmount = coupon.discountValue;
      }

      // Ensure we don't discount more than the order total
      discountAmount = Math.min(discountAmount, totalPrice);

      if (discountAmount > 0) {
        potentialOffers.push({
          offertype: "Coupon",
          offerdiscount: coupon.description,
          discounttotal: parseFloat(discountAmount.toFixed(2)),
          finaltotal: parseFloat((totalPrice - discountAmount).toFixed(2)),
          offervalidity: coupon.validUntil
        });
      }
    }
  }

  // 2. Evaluate Promotional Offers
  const activePromos = await PromotionalOffer.find({ isActive: true, validUntil: { $gt: now } });
  for (const promo of activePromos) {
    let discountAmount = totalPrice * (promo.discountPercentage / 100);
    discountAmount = Math.min(discountAmount, totalPrice);

    if (discountAmount > 0) {
      potentialOffers.push({
        offertype: "Promotional",
        offerdiscount: promo.description,
        discounttotal: parseFloat(discountAmount.toFixed(2)),
        finaltotal: parseFloat((totalPrice - discountAmount).toFixed(2)),
        offervalidity: promo.validUntil
      });
    }
  }

  // 3. Evaluate Campaign Pricing
  const activeCampaigns = await Campaign.find({ isActive: true, validUntil: { $gt: now } });
  for (const campaign of activeCampaigns) {
    let discountAmount = totalPrice * (campaign.discountPercentage / 100);
    discountAmount = Math.min(discountAmount, totalPrice);

    if (discountAmount > 0) {
      potentialOffers.push({
        offertype: "Campaign",
        offerdiscount: `${campaign.name} - ${campaign.discountPercentage}% off`,
        discounttotal: parseFloat(discountAmount.toFixed(2)),
        finaltotal: parseFloat((totalPrice - discountAmount).toFixed(2)),
        offervalidity: campaign.validUntil
      });
    }
  }

  // 4. Evaluate Bundle Pricing
  // Rule: If > 1 product AND total product price > 300, give 5% off on total.
  if (totalProductsCount > 1 && totalProductPrice > 300) {
    let discountAmount = totalPrice * (5 / 100);
    discountAmount = Math.min(discountAmount, totalPrice);

    if (discountAmount > 0) {
      potentialOffers.push({
        offertype: "Bundle",
        offerdiscount: "Bundle Pricing: 5% off on total for ordering multiple products above 300rs",
        discounttotal: parseFloat(discountAmount.toFixed(2)),
        finaltotal: parseFloat((totalPrice - discountAmount).toFixed(2)),
        offervalidity: null // Bundles do not have a strict DB expiry in this simplified logic
      });
    }
  }

  // Select the Best Offer
  if (potentialOffers.length === 0) {
    return null;
  }

  // Sort descending by discounttotal to get the maximum discount
  potentialOffers.sort((a, b) => b.discounttotal - a.discounttotal);

  return potentialOffers[0];
};
