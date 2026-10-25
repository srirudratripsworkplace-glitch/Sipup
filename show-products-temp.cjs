require("dotenv").config();
const mysql = require("mysql2/promise");
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "ecommerce_db"
  });
  const [tables] = await c.query("SHOW TABLES");
  console.log("DATABASE TABLES:");
  console.table(tables);
  const [products] = await c.query("SELECT * FROM products LIMIT 100");
  console.log("CURRENT PRODUCTS:");
  console.table(products);
  await c.end();
})().catch(e => {
  console.error(e.message);
  process.exit(1);
});
