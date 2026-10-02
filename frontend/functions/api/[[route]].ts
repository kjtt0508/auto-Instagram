import { handle } from "hono/cloudflare-pages";
import { connectingAssembly } from "../../server/connection/infrastructure/connectingAssembly";
import { createApiApp } from "../../server/presentation/apiApp";

// Cloudflare Pages Functions の入口: /api/* をすべて Hono に渡す（ADR-0002）。ここで外部の実装を組み立てて渡す
export const onRequest = handle(createApiApp(connectingAssembly()));
