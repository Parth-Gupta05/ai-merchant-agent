import express from 'express';
import { invokeSupervisor } from '../agents/supervisorAgent.js';

const router = express.Router();

// Route to handle incoming requests to the Merchant Supervisor Agent
router.post('/invoke', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ message: 'Query is required' });
    }

    console.log(`\n=== API Request Received ===`);
    console.log(`User Query: "${query}"`);

    // The Supervisor parses the text, routes it to the Catalog Agent, and returns the strict JSON
    const result = await invokeSupervisor(query);
    
    res.json({ 
      success: true, 
      message: 'Supervisor Agent invoked successfully',
      data: result
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error invoking agent', error: error.message });
  }
});

export default router;
