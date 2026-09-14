import dotenv from "dotenv";
dotenv.config();

async function listModels() {
  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models?key=" + process.env.GEMINI_API_KEY;
    const response = await fetch(url);
    const data = await response.json();
    if (data.models) {
      console.log("Available Models:");
      data.models.forEach(m => console.log(m.name));
    } else {
      console.log("Error fetching models:", data);
    }
  } catch (error) {
    console.error(error);
  }
}

listModels();
