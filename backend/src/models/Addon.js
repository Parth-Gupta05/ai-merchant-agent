import mongoose from 'mongoose';

const addonSchema = new mongoose.Schema({
  addonId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: {
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
  },
  inventory: {
    available: { type: Boolean, default: true },
    quantity: { type: Number, default: 0 },
  },
  attributes: {
    type: Map,
    of: String,
  },
}, { timestamps: true });

const Addon = mongoose.model('Addon', addonSchema);
export default Addon;
