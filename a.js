app.post("/api/data", authenticateToken, async (req, res) => {
  try {
    // Validate Mongo connection and collection
    if (!dataCollection) {
      return res.status(500).json({ message: "Database not initialized" });
    }

    // Ensure user ID is valid
    let userId;
    try {
      userId = new ObjectId(req.user.id);
    } catch (err) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const data = req.body;

    // Insert into MongoDB
    const result = await dataCollection.insertOne({
      ...data,
      userId,
      createdAt: new Date(),
    });

    // --- Directory setup ---
    const mlDir = path.join(__dirname, "../ml_model");
    if (!fs.existsSync(mlDir)) fs.mkdirSync(mlDir);

    const d1Path = path.join(mlDir, "d1_no_veg.csv");
    const d2Path = path.join(mlDir, "d2_no_veg.csv");
    const combinedPath = path.join(mlDir, "d_combined.csv");
    const combinedJSONPath = path.join(mlDir, "d_combined.json");

    const d1Header =
      "Date,dealer1_id,Quantity,dealer1_buying_price_from_farmer\n";
    const d2Header =
      "Date,dealer2_id,dealer1_id,quantity,dealer2_buying_price_from_dealer1,dealer2_selling_price_to_customer,weather\n";
    const combinedHeader =
      "Date,dealer1_id,dealer2_id,weather,dealer1_buying_price_from_farmer,dealer2_buying_price_from_dealer1,dealer2_selling_price_to_customer\n";

    if (!fs.existsSync(d1Path)) fs.writeFileSync(d1Path, d1Header);
    if (!fs.existsSync(d2Path)) fs.writeFileSync(d2Path, d2Header);
    if (!fs.existsSync(combinedPath))
      fs.writeFileSync(combinedPath, combinedHeader);

    const {
      dealerType,
      dealerId,
      quantity,
      price,
      price_selling,
      weather,
      dealer1_id,
      date,
    } = data;

    // --- Append CSV ---
    if (dealerType === "D1") {
      fs.appendFileSync(
        d1Path,
        `${date},${dealerId},${quantity},${price || ""}\n`
      );
    } else if (dealerType === "D2") {
      fs.appendFileSync(
        d2Path,
        `${date},${dealerId},${dealer1_id || ""},${quantity || ""},${
          price || ""
        },${price_selling || ""},${weather || ""}\n`
      );
    } else {
      return res.status(400).json({ error: "Invalid dealer type" });
    }

    // --- Merge logic ---
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
        const [d1Date, dealer1_id_d1, , price_buy_d1] = matchD1.split(",");
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

    fs.writeFileSync(
      combinedPath,
      combinedHeader + combinedRecords.map((r) => r.join(",")).join("\n")
    );

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

    if (combinedRecords.length > 0) {
      const latest = combinedRecords[combinedRecords.length - 1];
      const feature1 = !isNaN(Number(latest[4])) ? Number(latest[4]) : 10.0;
      const feature2 = !isNaN(Number(latest[5])) ? Number(latest[5]) : 20.0;

      const mlResponse = await axios.post("http://127.0.0.1:5002/predict", {
        price_per_kg: feature1,
        price_per_kg1: feature2,
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
    console.error("Data Insert Error:", error.message, error.stack);
    res.status(500).json({ message: "Internal server error (ML/data)" });
  }
});
