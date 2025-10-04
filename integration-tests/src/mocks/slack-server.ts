import express from "express";
import { EventEmitter } from "node:events";

interface SlackMessage {
  ts: string;
  text?: string;
  blocks?: any[];
  channel: string;
  thread_ts?: string;
  user: string;
}

export class MockSlackServer extends EventEmitter {
  private app: express.Application;
  private server: any;
  private messages: Map<string, SlackMessage[]> = new Map();
  private reactions: Map<string, Set<string>> = new Map();
  public dispatcherUrl: string = "http://localhost:3000";

  constructor(private port: number = 4001) {
    super();
    this.app = express();
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.setupEndpoints();
  }

  private setupEndpoints() {
    // Mock chat.postMessage
    this.app.post("/api/chat.postMessage", (req, res) => {
      const { channel, text, thread_ts, blocks } = req.body;
      const ts = `${Date.now() / 1000}.${Math.random().toString().slice(2, 8)}`;

      const message: SlackMessage = {
        ts,
        text,
        blocks,
        channel,
        thread_ts: thread_ts || ts,
        user: "UBOT123",
      };

      const threadKey = thread_ts || ts;
      const threadMessages = this.messages.get(threadKey) || [];
      threadMessages.push(message);
      this.messages.set(threadKey, threadMessages);

      this.emit("message:posted", message);
      res.json({ ok: true, ts, channel });
    });

    // Mock reactions.add
    this.app.post("/api/reactions.add", (req, res) => {
      const { channel, timestamp, name } = req.body;
      const key = `${channel}:${timestamp}`;

      const reactions = this.reactions.get(key) || new Set();
      reactions.add(name);
      this.reactions.set(key, reactions);

      this.emit("reaction:added", { channel, timestamp, name });
      res.json({ ok: true });
    });

    // Mock reactions.remove
    this.app.post("/api/reactions.remove", (req, res) => {
      const { channel, timestamp, name } = req.body;
      const key = `${channel}:${timestamp}`;

      const reactions = this.reactions.get(key) || new Set();
      reactions.delete(name);
      this.reactions.set(key, reactions);

      this.emit("reaction:removed", { channel, timestamp, name });
      res.json({ ok: true });
    });

    // Mock users.info
    this.app.post("/api/users.info", (req, res) => {
      const { user } = req.body;
      res.json({
        ok: true,
        user: {
          id: user,
          name: `user_${user.toLowerCase()}`,
          real_name: "Test User",
          profile: { display_name: "Test User" },
        },
      });
    });

    // Mock conversations.history
    this.app.post("/api/conversations.history", (req, res) => {
      const { ts } = req.body;
      const messages = this.messages.get(ts) || [];
      res.json({ ok: true, messages });
    });

    // Mock auth.test
    this.app.post("/api/auth.test", (_req, res) => {
      res.json({
        ok: true,
        url: "https://test-workspace.slack.com/",
        team: "Test Workspace",
        user: "test-bot",
        user_id: "UBOT123",
        bot_id: "BBOT123",
        team_id: "T123456",
        enterprise_id: null,
      });
    });
  }

  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`Mock Slack server running on port ${this.port}`);
        resolve(void 0);
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
      this.server?.close(() => resolve(void 0));
    });
  }

  // Simulate user sending a message
  async simulateUserMessage(
    channel: string,
    text: string,
    userId: string = "U123456",
    threadTs?: string
  ) {
    const ts = `${Date.now() / 1000}.${Math.random().toString().slice(2, 8)}`;

    const event = {
      type: "message",
      text,
      user: userId,
      ts,
      thread_ts: threadTs,
      channel,
      event_ts: ts,
    };

    // Store the message locally for testing
    const message: SlackMessage = {
      ts,
      text,
      channel,
      thread_ts: threadTs || ts,
      user: userId,
    };

    const threadKey = threadTs || ts;
    const threadMessages = this.messages.get(threadKey) || [];
    threadMessages.push(message);
    this.messages.set(threadKey, threadMessages);

    // Try to post to dispatcher if available
    let response = null;
    try {
      response = await fetch(`${this.dispatcherUrl}/slack/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "event_callback",
          event,
        }),
      });
    } catch (error) {
      // Dispatcher not running, that's OK for unit tests
      console.log("Dispatcher not available, running in mock mode");
    }

    return { ts, response };
  }

  // Simulate button click
  async simulateButtonClick(
    actionId: string,
    value: string,
    messageTs: string,
    userId: string = "U123456"
  ) {
    const payload = {
      type: "block_actions",
      actions: [
        {
          action_id: actionId,
          value,
          type: "button",
        },
      ],
      user: { id: userId },
      channel: { id: "C123456" },
      message: { ts: messageTs },
    };

    const response = await fetch(`${this.dispatcherUrl}/slack/interactive`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `payload=${encodeURIComponent(JSON.stringify(payload))}`,
    });

    return response;
  }

  // Helper methods
  getThreadMessages(threadTs: string): SlackMessage[] {
    return this.messages.get(threadTs) || [];
  }

  getReactions(channel: string, timestamp: string): string[] {
    return Array.from(this.reactions.get(`${channel}:${timestamp}`) || []);
  }

  clearMessages() {
    this.messages.clear();
    this.reactions.clear();
  }

  waitForMessage(
    threadTs: string,
    matcher: (msg: SlackMessage) => boolean,
    timeout = 5000
  ): Promise<SlackMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for message in thread ${threadTs}`));
      }, timeout);

      const checkMessages = () => {
        const messages = this.getThreadMessages(threadTs);
        const found = messages.find(matcher);
        if (found) {
          clearTimeout(timer);
          resolve(found);
        }
      };

      this.on("message:posted", checkMessages);
      checkMessages(); // Check immediately
    });
  }
}

// Run server if this file is executed directly
if (import.meta.main) {
  const server = new MockSlackServer();
  server.start().then(() => {
    console.log("Mock Slack server ready");
  });
}
