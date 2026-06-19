export { route } from "./http/router";
export { Conversation } from "./state/conversation";
import { route } from "./http/router";
import type { RuntimeEnv } from "./config";

export default {
  fetch(request, env) {
    return route(request, env as RuntimeEnv);
  },
} satisfies ExportedHandler<Env>;
