import 'dotenv/config'; 
import mongoose from 'mongoose';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';

// Import Models
import Product from './src/models/Product.js';
import Addon from './src/models/Addon.js';
import Coupon from './src/models/Coupon.js';
import Campaign from './src/models/Campaign.js';
import PromotionalOffer from './src/models/PromotionalOffer.js';

// Initialize Embeddings
const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "text-embedding-004", // Using the correct available embedding model to avoid 404s
  apiKey: process.env.GEMINI_API_KEY,
});

const generateEmbedding = async (text) => {
  try {
    return await embeddings.embedQuery(text);
  } catch (error) {
    console.error(`Failed to generate embedding for: ${text}`, error.message);
    return []; // Return empty array if rate limit or API error occurs
  }
};

const seedDatabase = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected.');

    // Clear existing data
    console.log('Clearing existing data...');
    await Product.deleteMany({});
    await Addon.deleteMany({});
    await Coupon.deleteMany({});
    await Campaign.deleteMany({});
    await PromotionalOffer.deleteMany({});

    // 1. Seed Addons
    console.log('Seeding Addons...');
    const addon1 = new Addon({
      addonId: 'addon-giftbox',
      name: 'Premium Gift Packaging',
      description: 'A beautiful velvet box with a handwritten note.',
      price: { amount: 250, currency: 'INR' },
      inventory: { available: true, quantity: 500 },
      attributes: { material: 'velvet', color: 'black' }
    });
    const addon2 = new Addon({
      addonId: 'addon-warranty',
      name: '2-Year Extended Warranty',
      description: 'Complete protection for your electronics.',
      price: { amount: 500, currency: 'INR' },
      inventory: { available: true, quantity: 9999 }
    });
    
    await addon1.save();
    await addon2.save();
    console.log('Addons seeded.');

    // 2. Seed Products
    console.log('Seeding Products and generating embeddings...');
    const productsToSeed = [
      {
        productId: 'prod-bracelet-001',
        name: 'Obsidian Protection Bracelet',
        description: 'A handcrafted bracelet made from pure volcanic obsidian to ward off negative energy.',
        category: 'Jewelry',
        price: { amount: 1200, currency: 'INR' },
        inventory: { available: true, quantity: 100 },
        attributes: { material: 'obsidian', color: 'black' },
        addons: [addon1._id], // Link to giftbox
        tags: ['protection', 'crystal', 'handmade'],
        useCases: ['gifting', 'daily wear', 'meditation']
      },
      {
        productId: 'prod-bracelet-002',
        name: 'Rose Quartz Calm Bracelet',
        description: 'Premium rose quartz bracelet for bringing peace and emotional healing.',
        category: 'Jewelry',
        price: { amount: 1500, currency: 'INR' },
        inventory: { available: true, quantity: 50 },
        attributes: { material: 'rose quartz', color: 'pink' },
        addons: [addon1._id], // Link to giftbox
        tags: ['love', 'healing', 'crystal'],
        useCases: ['gifting', 'yoga']
      },
      {
        productId: 'prod-powerbank-001',
        name: 'Compact PowerBank 10000mAh',
        description: 'Fast charging, ultra-slim 10000mAh portable charger with USB-C.',
        category: 'Electronics',
        price: { amount: 1499, currency: 'INR' },
        inventory: { available: true, quantity: 200 },
        attributes: { capacity: '10000mAh', color: 'black' },
        addons: [addon2._id], // Link to warranty
        tags: ['portable', 'fast charge', 'battery'],
        useCases: ['travel', 'daily commute']
      },
      {
        productId: 'prod-powerbank-002',
        name: 'Pro Max PowerBank 20000mAh',
        description: 'Heavy duty 20000mAh powerbank capable of charging laptops.',
        category: 'Electronics',
        price: { amount: 2999, currency: 'INR' }, // Upsell option for powerbank
        inventory: { available: true, quantity: 80 },
        attributes: { capacity: '20000mAh', color: 'grey' },
        addons: [addon2._id], // Link to warranty
        tags: ['heavy duty', 'laptop charging', 'battery'],
        useCases: ['camping', 'remote work']
      }
    ];

    for (const prodData of productsToSeed) {
      const textToEmbed = `${prodData.name} - ${prodData.description} - ${prodData.category} - ${prodData.tags.join(', ')}`;
      const embedding = await generateEmbedding(textToEmbed);
      
      const prod = new Product({
        ...prodData,
        embedding: embedding.length > 0 ? embedding : undefined
      });
      await prod.save();
      console.log(`Saved product: ${prod.name}`);
    }

    // 3. Seed Offers (Coupons, Promos, Campaigns)
    console.log('Seeding Offers...');
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1); // Valid for 1 year

    const coupon1 = new Coupon({
      code: 'WELCOME10',
      description: '10% off for new users',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      minOrderValue: 500,
      validUntil: futureDate,
      isActive: true
    });

    const coupon2 = new Coupon({
      code: 'FLAT500',
      description: 'Flat ₹500 off on large orders',
      discountType: 'FIXED',
      discountValue: 500,
      minOrderValue: 3000,
      validUntil: futureDate,
      isActive: true
    });

    const promo1 = new PromotionalOffer({
      name: 'Festive Season Promo',
      description: 'Special 15% festive discount across all products',
      discountPercentage: 15,
      validUntil: futureDate,
      isActive: true
    });

    const campaign1 = new Campaign({
      name: 'Diwali Mega Sale',
      discountPercentage: 20,
      validUntil: futureDate,
      isActive: true
    });

    await coupon1.save();
    await coupon2.save();
    await promo1.save();
    await campaign1.save();
    console.log('Offers seeded.');

    console.log('🎉 Database seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    process.exit(1);
  }
};

seedDatabase();
