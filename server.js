// Dev/serve entry point for SimpleSynthSeq.
// Bun's HTML import bundles index.html together with the <script>/<link>
// files it references (app.js, style.css) and, in development mode,
// serves them with hot reload — edits to any of the three files push
// straight to the browser without a manual refresh.
import homepage from "./index.html";

const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,
  routes: {
    "/": homepage,
  },
  development: true,
});

console.log(`SimpleSynthSeq kører på ${server.url}`);
