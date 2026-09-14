import { z } from "zod";
import Razorpay from "razorpay";
import Order from "../models/Order.js";

let razorpayInstance = null;
try {
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    razorpayInstance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  } else {
    console.warn("[Payment Agent] Razorpay keys missing in environment variables.");
  }
} catch (error) {
  console.error("[Payment Agent] Failed to initialize Razorpay:", error);
}

// ------------------------------------------------------------------
// 1. Payment Agent Input Schema (What the Supervisor sends IN)
// ------------------------------------------------------------------
export const PaymentInputSchema = z.object({
  orderId: z.string().describe("The ID of the order to process payment for."),
  action: z.enum(["GENERATE_LINK", "VERIFY_STATUS"]).describe("Whether to generate a new payment link or verify an existing payment status.")
});

// ------------------------------------------------------------------
// 2. Payment Agent Output Schema (What the Payment Agent returns OUT)
// ------------------------------------------------------------------
export const PaymentOutputSchema = z.object({
  status: z.enum(["LINK_GENERATED", "COMPLETED", "PENDING", "FAILED", "ERROR"]),
  paymentLink: z.string().optional().describe("The generated payment link URL."),
  message: z.string().describe("Contextual message about what happened.")
});

// ------------------------------------------------------------------
// 3. Agent Execution Logic
// ------------------------------------------------------------------
export const invokePaymentAgent = async (payload) => {
  try {
    const { orderId, action } = payload;

    if (!orderId) {
      return { status: "ERROR", message: "Missing orderId." };
    }

    const order = await Order.findById(orderId).populate('userId');
    if (!order) {
      return { status: "ERROR", message: `Order ${orderId} not found.` };
    }

    if (action === "VERIFY_STATUS") {
      // If the user paid, the /callback route would have updated this to COMPLETED.
      return {
        status: order.paymentStatus || "PENDING",
        message: `The payment status for order ${orderId} is currently ${order.paymentStatus || "PENDING"}.`
      };
    }

    if (action === "GENERATE_LINK") {
      if (order.paymentStatus === 'COMPLETED') {
        return {
          status: "COMPLETED",
          message: `Order ${orderId} is already fully paid.`
        };
      }

      // If a link already exists and is pending, just return it so we don't spam Razorpay API
      if (order.paymentLink && order.paymentStatus === 'PENDING') {
        return {
          status: "LINK_GENERATED",
          paymentLink: order.paymentLink,
          message: `Here is the existing active payment link for order ${orderId}.`
        };
      }

      if (!razorpayInstance) {
        return { status: "ERROR", message: "Razorpay is not configured on the server." };
      }

      // Final total is stored in INR or similar, Razorpay requires amount in subunits (paise for INR)
      const amountInSubunits = Math.round(order.finalTotal * 100);

      // We need a stable callback URL (assuming localhost:5000 for local testing)
      // In production, this would be your actual domain name
      const callbackUrl = `http://localhost:5000/api/payment/callback`;

      const paymentLinkRequest = {
        amount: amountInSubunits,
        currency: "INR",
        accept_partial: false,
        reference_id: order._id.toString(), // critical for callback matching
        description: `Payment for Order ${order._id}`,
        customer: {
          name: order.userId?.name || "Customer",
          email: order.userId?.email || "",
          contact: order.userId?.phone || ""
        },
        notify: {
          sms: false,
          email: false
        },
        reminder_enable: false,
        callback_url: callbackUrl,
        callback_method: "get"
      };

      const paymentLinkResponse = await razorpayInstance.paymentLink.create(paymentLinkRequest);

      // Save the generated link to the DB
      order.paymentLink = paymentLinkResponse.short_url;
      order.paymentStatus = 'PENDING';
      await order.save();

      return {
        status: "LINK_GENERATED",
        paymentLink: order.paymentLink,
        message: `Payment link successfully generated for order ${orderId}.`
      };
    }

    return { status: "ERROR", message: "Invalid action specified." };

  } catch (error) {
    console.error("[Payment Agent] Error:", error);
    return {
      status: "ERROR",
      message: "An internal error occurred while processing the payment request."
    };
  }
};
