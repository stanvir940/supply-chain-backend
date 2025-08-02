// server.js (With Authentication and Data Insertion)

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
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
  console.log("Auth Header:", authHeader); // Debug line
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
  const { name, email, password } = req.body;
  try {
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser)
      return res.status(400).json({ error: "Email already in use" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await usersCollection.insertOne({
      name,
      email,
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

// Protected Route: Get My Info
app.get("/api/me", authenticateToken, async (req, res) => {
  try {
    const user = await usersCollection.findOne({
      _id: new ObjectId(req.user.id),
    });

    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ name: user.name, email: user.email });
  } catch (error) {
    console.error("Get User Info Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start Server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
