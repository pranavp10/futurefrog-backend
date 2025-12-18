import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { getCoinsRoute } from "./routes/getCoints";
import { cryptoMoversRoutes } from "./routes/crypto-movers";
import { buybackWalletRoutes } from "./routes/buyback-wallet";
import { triggerSnapshotRoute } from "./routes/trigger-snapshot";

const app = new Elysia()
  .use(cors())
  .use(getCoinsRoute)
  .use(cryptoMoversRoutes)
  .use(buybackWalletRoutes)
  .use(triggerSnapshotRoute)
  .get("/", () => "Hello Elysia")
  .listen(process.env.PORT || 3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
