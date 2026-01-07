import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { kalshiMarketsRoutes } from "./routes/kalshi-markets";

const app = new Elysia()
  .use(cors())
  .use(kalshiMarketsRoutes)
  .get("/", () => {
    return {
      message: "Kalshi Markets API",
    };
  })
  .listen(process.env.PORT || 3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
