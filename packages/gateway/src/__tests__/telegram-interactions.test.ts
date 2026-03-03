import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { InteractionService } from "../interactions";
import { TelegramInteractionRenderer } from "../telegram/interactions";

describe("TelegramInteractionRenderer link buttons", () => {
  const sendMessage = mock(() => Promise.resolve({}));
  const bot = { api: { sendMessage } } as any;
  const interactionService = new InteractionService();
  const renderer = new TelegramInteractionRenderer(bot, interactionService);

  afterEach(() => {
    sendMessage.mockClear();
  });

  afterAll(() => {
    renderer.shutdown();
  });

  test("renders install links as WebApp buttons", async () => {
    await renderer.renderLinkButton({
      id: "lb_test",
      userId: "u1",
      conversationId: "c1",
      channelId: "123",
      platform: "telegram",
      url: "https://example.com/settings?st=abc",
      label: "Install Skill",
      linkType: "install",
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, , options] = sendMessage.mock.calls[0] as [number, string, any];
    const button = options.reply_markup.inline_keyboard[0][0];
    expect(button.web_app?.url).toBe("https://example.com/settings?st=abc");
    expect(button.url).toBeUndefined();
  });

  test("renders settings links as WebApp buttons", async () => {
    await renderer.renderLinkButton({
      id: "lb_test",
      userId: "u1",
      conversationId: "c1",
      channelId: "123",
      platform: "telegram",
      url: "https://example.com/settings?st=abc",
      label: "Open Settings",
      linkType: "settings",
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, , options] = sendMessage.mock.calls[0] as [number, string, any];
    const button = options.reply_markup.inline_keyboard[0][0];
    expect(button.web_app?.url).toBe("https://example.com/settings?st=abc");
    expect(button.url).toBeUndefined();
  });

  test("renders oauth links as URL buttons", async () => {
    await renderer.renderLinkButton({
      id: "lb_test",
      userId: "u1",
      conversationId: "c1",
      channelId: "123",
      platform: "telegram",
      url: "https://accounts.example.com/oauth",
      label: "Login",
      linkType: "oauth",
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, , options] = sendMessage.mock.calls[0] as [number, string, any];
    const button = options.reply_markup.inline_keyboard[0][0];
    expect(button.url).toBe("https://accounts.example.com/oauth");
    expect(button.web_app).toBeUndefined();
  });
});
