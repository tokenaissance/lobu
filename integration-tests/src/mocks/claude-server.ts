import express from "express";

interface ClaudeResponse {
  trigger: string | RegExp;
  response: Array<{
    type: "text" | "tool_use" | "error";
    content: string;
    toolName?: string;
    toolInput?: any;
  }>;
}

export class MockClaudeServer {
  private app: express.Application;
  private server: any;
  private responses: ClaudeResponse[] = [];
  private requests: any[] = [];

  constructor(private port: number = 8081) {
    this.app = express();
    this.app.use(express.json());
    this.setupEndpoints();
  }

  private setupEndpoints() {
    this.app.post("/v1/messages", async (req, res) => {
      this.requests.push(req.body);
      const messageContent = JSON.stringify(req.body);

      // Find matching response
      const matchedResponse = this.responses.find((r) => {
        if (typeof r.trigger === "string") {
          return messageContent.includes(r.trigger);
        }
        return r.trigger.test(messageContent);
      });

      if (!matchedResponse) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        res.write(`data: {"type":"text","content":"Default response"}\n\n`);
        res.end();
        return;
      }

      // Stream response
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });

      for (const chunk of matchedResponse.response) {
        if (chunk.type === "text") {
          res.write(
            `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"${chunk.content}"}}\n\n`
          );
        } else if (chunk.type === "tool_use") {
          res.write(
            `data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"tool_${Date.now()}","name":"${chunk.toolName}"}}\n\n`
          );
          res.write(
            `data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"${JSON.stringify(chunk.toolInput)}"}}\n\n`
          );
        } else if (chunk.type === "error") {
          res.status(500).json({ error: { message: chunk.content } });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      res.write(`data: {"type":"message_stop"}\n\n`);
      res.end();
    });

    // Health check
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok", mock: true });
    });
  }

  // Setup response for a trigger
  onMessage(trigger: string | RegExp) {
    const response: ClaudeResponse = {
      trigger,
      response: [],
    };
    this.responses.push(response);

    return {
      reply: (chunks: ClaudeResponse["response"]) => {
        response.response = chunks;
      },
    };
  }

  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`Mock Claude server running on port ${this.port}`);
        resolve(void 0);
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
      this.server?.close(() => resolve(void 0));
    });
  }

  getRequests() {
    return this.requests;
  }

  clearResponses() {
    this.responses = [];
    this.requests = [];
  }
}

// Run server if this file is executed directly
if (import.meta.main) {
  const server = new MockClaudeServer();
  server.start().then(() => {
    console.log("Mock Claude server ready");
  });
}
