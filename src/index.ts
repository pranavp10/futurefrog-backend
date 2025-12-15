import { Elysia } from "elysia";
import { getCoinsRoute } from "./routes/getCoints";

const app = new Elysia()
  .use(getCoinsRoute)
  .get("/", () => "Hello Elysia")
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
