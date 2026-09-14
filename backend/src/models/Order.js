import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  productPrice: {
    type: Number,
    required: true,
    default: 0
  },
  addons: [{
    addonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Addon'
    },
    addonPrice: {
      type: Number,
      default: 0
    }
  }]
}, { _id: false });

const orderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  items: [orderItemSchema],
  totalPrice: {
    type: Number,
    required: true,
    default: 0
  },
  offerType: {
    type: String,
    default: null
  },
  offerDiscount: {
    type: String,
    default: null
  },
  discountTotal: {
    type: Number,
    default: 0
  },
  finalTotal: {
    type: Number,
    required: true,
    default: 0
  },
  offerValidity: {
    type: Date,
    default: null
  },
  paymentId: {
    type: String,
    default: null
  },
  paymentLink: {
    type: String,
    default: null
  },
  paymentStatus: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED'],
    default: 'PENDING'
  },
  status: {
    type: String,
    enum: ['PENDING_OFFERS', 'CONFIRMED', 'SHIPPED', 'CANCELLED'],
    default: 'PENDING_OFFERS'
  },
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
export default Order;
