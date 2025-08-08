// server.js (With Authentication and Data Insertion)

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");
const axios = require("axios"); // ✅ [NEW] For communicating with Flask ML API

const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(
  cors({
    origin: "http://localhost:5173", // your frontend origin
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(bodyParser.json());

// MongoDB Client
const client = new MongoClient(process.env.MONGO_URI);
let usersCollection, dataCollection;

client
  .connect()
  .then(() => {
    console.log("Connected to MongoDB");
    const db = client.db("test");
    usersCollection = db.collection("users");
    dataCollection = db.collection("datas");
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  });

// Helper: Authenticate Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  // console.log("Auth Header:", authHeader); // Debug line
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
}

// Register Route
app.post("/api/register", async (req, res) => {
  const { name, email, dealerType, password } = req.body;
  try {
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser)
      return res.status(400).json({ error: "Email already in use" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await usersCollection.insertOne({
      name,
      email,
      dealerType,
      // dealerType: dealerType === "D1" ? "D1" : "
      password: hashedPassword,
    });

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login Route
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await usersCollection.findOne({ email });

    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { id: user._id.toString(), email: user.email },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      }
    );
    console.log("Login successful for user:", user.email); // Debug line
    res.json({ token, user: { name: user.name, email: user.email } });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/*
// Protected Route: Insert Data
app.post("/api/data", authenticateToken, async (req, res) => {
  try {
    const data = req.body;
    console.log("Received data:", data);
    console.log("Authenticated user:", req.user);

    const result = await dataCollection.insertOne({
      ...data,
      userId: new ObjectId(req.user.id), // check this!
    });

    res.status(201).json({
      message: "Data inserted successfully",
      data: { ...data, _id: result.insertedId },
    });
  } catch (error) {
    console.error("Insert Data Error:", error); // 🔥 this line is crucial
    res.status(500).json({ message: "Internal server error" });
  }
});
*/
// Protected Route: Get My Info
app.get("/api/me", authenticateToken, async (req, res) => {
  try {
    const user = await usersCollection.findOne({
      _id: new ObjectId(req.user.id),
    });

    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({
      name: user.name,
      email: user.email,
      dealerType: user.dealerType,
    });
  } catch (error) {
    console.error("Get User Info Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ [NEW] Protected Route: ML Prediction
app.post("/api/predict", authenticateToken, async (req, res) => {
  try {
    const inputData = req.body; // should be JSON with model features
    console.log("Input to ML model:", inputData);

    const response = await axios.post(
      "http://127.0.0.1:5002/predict",
      inputData
    );

    res.json({ prediction: response.data.prediction });
  } catch (error) {
    console.error("Prediction Error:", error.message);
    res.status(500).json({ error: "Prediction failed" });
  }
});

// modified today

app.post("/api/data", authenticateToken, async (req, res) => {
  try {
    const data = req.body;
    const userId = new ObjectId(req.user.id);
    const result = await dataCollection.insertOne({ ...data, userId });

    // Paths
    const mlDir = path.join(__dirname, "../ml_model");
    if (!fs.existsSync(mlDir)) fs.mkdirSync(mlDir);

    const d1Path = path.join(mlDir, "d1_no_veg.csv");
    const d2Path = path.join(mlDir, "d2_no_veg.csv");
    const combinedPath = path.join(mlDir, "d_combined.csv");
    const combinedJSONPath = path.join(mlDir, "d_combined.json");

    // Headers
    // const d1Header = "Date,dealer1_id,Quantity,price_per_kg\n";
    // const d2Header =
    //   "Date,dealer2_id,dealer1_id,quantity,price_per_kg1,weather\n";
    // const combinedHeader =
    //   "Date,dealer2_id,dealer1_id,quantity,price_per_kg,price_per_kg1,weather\n";
    const d1Header =
      "Date,dealer1_id,Quantity,dealer1_buying_price_from_farmer\n";
    const d2Header =
      "Date,dealer2_id,dealer1_id,quantity,dealer2_buying_price_from_dealer1,dealer2_selling_price_to_customer,weather\n";
    const combinedHeader =
      "Date,dealer1_id,dealer2_id,weather,dealer1_buying_price_from_farmer,dealer2_buying_price_from_dealer1,dealer2_selling_price_to_customer\n";
    // Create files if missing
    if (!fs.existsSync(d1Path)) fs.writeFileSync(d1Path, d1Header);
    if (!fs.existsSync(d2Path)) fs.writeFileSync(d2Path, d2Header);
    if (!fs.existsSync(combinedPath))
      fs.writeFileSync(combinedPath, combinedHeader);

    const {
      dealerType,
      dealerId,
      quantity,
      price,
      price_per_kg1,
      weather,
      dealer1_id,
      date,
    } = data;

    // Save to respective CSV
    if (dealerType === "D1") {
      fs.appendFileSync(d1Path, `${date},${dealerId},${quantity},${price}\n`);
    } else if (dealerType === "D2") {
      fs.appendFileSync(
        d2Path,
        `${date},${dealerId},${dealer1_id},${quantity},${price},${
          weather || ""
        }\n`
      );
    } else {
      return res.status(400).json({ error: "Invalid dealer type" });
    }

    // ---- Rebuild combined CSV every time ----
    const d1Rows = fs.readFileSync(d1Path, "utf8").trim().split("\n").slice(1);
    const d2Rows = fs.readFileSync(d2Path, "utf8").trim().split("\n").slice(1);

    let combinedRecords = [];

    d2Rows.forEach((d2Line) => {
      if (!d2Line) return;
      const [
        d2Date,
        dealer2_id,
        dealer1_id_d2,
        qty_d2,
        price_buy_d2,
        price_sell_d2,
        weather_d2,
      ] = d2Line.split(",");

      const matchD1 = d1Rows.find((d1Line) => {
        if (!d1Line) return false;
        const [d1Date, dealer1_id_d1, qty_d1, price_buy_d1] = d1Line.split(",");
        return dealer1_id_d1 === dealer1_id_d2 && d1Date === d2Date;
      });

      if (matchD1) {
        const [d1Date, dealer1_id_d1, price_buy_d1] = matchD1.split(",");
        combinedRecords.push([
          d2Date,
          dealer1_id_d1,
          dealer2_id,
          weather_d2 || "",
          price_buy_d1 || "",
          price_buy_d2 || "",
          price_sell_d2 || "",
        ]);
      }
    });

    // Write combined CSV
    fs.writeFileSync(
      combinedPath,
      combinedHeader + combinedRecords.map((r) => r.join(",")).join("\n")
    );

    // Generate JSON from combined
    fs.writeFileSync(
      combinedJSONPath,
      JSON.stringify(
        combinedRecords.map((r) => ({
          Date: r[0],
          dealer1_id: r[1],
          dealer2_id: r[2],
          weather: r[3],
          dealer1_buying_price_from_farmer: r[4],
          dealer2_buying_price_from_dealer1: r[5],
          dealer2_selling_price_to_customer: r[6],
        })),
        null,
        2
      )
    );

    // console.log(parseFloat(latest[4]), parseFloat(latest[5])); // Debug line
    // If new merge happened, run ML prediction
    if (combinedRecords.length > 0) {
      const latest = combinedRecords[combinedRecords.length - 1];
      const mlResponse = await axios.post("http://127.0.0.1:5002/predict", {
        feature1: parseFloat(latest[4]) || 20, // price_per_kg from D1
        feature2: parseFloat(latest[5]) || 30, // price_per_kg1 from D2
      });

      return res.status(201).json({
        message: "D1 + D2 merged, prediction complete",
        prediction: mlResponse.data.prediction,
        data: { ...data, _id: result.insertedId },
      });
    }

    return res.status(201).json({
      message: `Data saved for ${dealerType}. Waiting for counterpart.`,
      data: { ...data, _id: result.insertedId },
    });
  } catch (error) {
    console.error("Data Insert Error:", error.message);
    res.status(500).json({ message: "Internal server error (ML/data)" });
  }
});

// Tanvir is making a new route to predict today's price without CSV
// This is a new route to predict today's price without needing CSV files
app.get("/api/predict", async (req, res) => {
  try {
    // Call the Flask ML prediction API without any payload
    const response = await axios.post("http://127.0.0.1:5002/predict", {});

    const predictedPrice = response.data.predicted_price;

    res.json({ predicted_price: predictedPrice });
  } catch (error) {
    console.error("Error fetching prediction:", error.message);
    res.status(500).json({ error: "Failed to fetch prediction" });
  }
});

// Updated POST /api/data

// NEW ROUTE: Predict today's price without CSV
app.get("/api/predict-today", async (req, res) => {
  try {
    const mlResponse = await axios.post("http://127.0.0.1:5002/predict", {
      feature1: 10.0, // example avg dealer1 price
      feature2: 28.0, // example avg dealer2 price
    });
    res.json({
      date: new Date().toISOString().split("T")[0],
      predicted_price: mlResponse.data.prediction,
    });
  } catch (error) {
    console.error("Prediction error:", error.message);
    res.status(500).json({ message: "Failed to get prediction" });
  }
});

// admin dashboard route
// ✅ Admin Route: Get all users (excluding password)
app.get("/api/users", authenticateToken, async (req, res) => {
  try {
    // Optional: You can check if the logged-in user is an admin here
    // if (req.user.email !== "admin@example.com") {
    //   return res.status(403).json({ error: "Forbidden" });
    // }

    const users = await usersCollection
      .find({}, { projection: { password: 0 } }) // exclude password
      .toArray();

    res.json(users);
  } catch (error) {
    console.error("Get All Users Error:", error.message);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ✅ Admin Route: Get all users with their stock & transactions
app.get("/api/admin/users-data", authenticateToken, async (req, res) => {
  try {
    // Optional: check if user is admin
    // if (req.user.email !== "admin@example.com") {
    //   return res.status(403).json({ error: "Forbidden" });
    // }

    // Get all users (excluding password)
    const users = await usersCollection
      .find({}, { projection: { password: 0 } })
      .toArray();

    // For each user, get their stock data
    const usersWithStock = await Promise.all(
      users.map(async (user) => {
        const stockData = await dataCollection
          .find({ userId: new ObjectId(user._id) })
          .toArray();

        return { ...user, stockData };
      })
    );

    res.json(usersWithStock);
  } catch (error) {
    console.error("Admin Users Data Error:", error.message);
    res.status(500).json({ error: "Failed to fetch users data" });
  }
});

// Start Server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
