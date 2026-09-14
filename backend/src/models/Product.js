import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  productId: {
    type: String,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    required: true,
  },
  price: {
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'INR',
    },
  },
  inventory: {
    available: {
      type: Boolean,
      default: true,
    },
    quantity: {
      type: Number,
      default: 0,
    },
  },
  attributes: {
    type: Map,
    of: String, // e.g., color: "black", material: "stone"
  },
  addons: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Addon' }],
  tags: [String],
  useCases: [String],
  embedding: {
    type: [Number],
    required: false, // Will be populated by the seeder script
  }
}, {
  timestamps: true,
});

const Product = mongoose.model('Product', productSchema);

export default Product;
