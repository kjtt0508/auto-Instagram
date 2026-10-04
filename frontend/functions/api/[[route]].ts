import { handle } from "hono/cloudflare-pages";
import { apiAssembly } from "../../server/shared/infrastructure/apiAssembly";
import { createApiApp } from "../../server/presentation/apiApp";

// Cloudflare Pages Functions の入口: /api/* をすべて Hono に渡す（ADR-0002）。ここで外部の実装を組み立てて渡す
export const onRequest = handle(createApiApp(apiAssembly()));
