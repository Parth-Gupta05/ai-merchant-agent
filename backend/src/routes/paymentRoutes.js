import express from 'express';
import Order from '../models/Order.js';

const router = express.Router();

/**
 * Razorpay Payment Callback Route
 * Razorpay redirects here after a payment attempt on the Payment Link.
 */
router.get('/callback', async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_payment_link_status, razorpay_payment_link_reference_id } = req.query;

    if (!razorpay_payment_link_reference_id) {
      return res.status(400).send("<h3>Missing Order Reference ID</h3>");
    }

    const orderId = razorpay_payment_link_reference_id;
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).send("<h3>Order not found</h3>");
    }

    if (razorpay_payment_link_status === 'paid' || razorpay_payment_id) {
      order.paymentStatus = 'COMPLETED';
      order.paymentId = razorpay_payment_id;
      order.status = 'CONFIRMED';
      await order.save();

      return res.send(`
        <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
          <h2 style="color: #4CAF50;">Payment Successful! 🎉</h2>
          <p>Your order (ID: ${orderId}) has been confirmed.</p>
          <p style="font-weight: bold;">You can now close this tab and tell the chat agent that you have paid.</p>
        </div>
      `);
    } else {
      order.paymentStatus = 'FAILED';
      await order.save();

      return res.send(`
        <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
          <h2 style="color: #f44336;">Payment Failed ❌</h2>
          <p>Something went wrong with your payment for order ID: ${orderId}.</p>
          <p style="font-weight: bold;">Please close this tab and ask the chat agent for a new payment link.</p>
        </div>
      `);
    }
  } catch (error) {
    console.error("[Payment Callback Error]", error);
    res.status(500).send("<h3>Internal Server Error</h3>");
  }
});

export default router;
