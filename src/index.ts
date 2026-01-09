import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { kalshiMarketsRoutes } from "./routes/kalshi-markets";
import { cryptoCacheRoutes } from "./routes/crypto-cache";

const app = new Elysia()
  .use(cors())
  .use(kalshiMarketsRoutes)
  .use(cryptoCacheRoutes)
  .get("/", () => {
    return {
      message: "FutureFrog API",
    };
  })
  .listen(process.env.PORT || 3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
