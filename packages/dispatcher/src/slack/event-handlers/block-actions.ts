#!/usr/bin/env bun

import logger from "../../logger";

/**
 * Block action handlers for interactive elements
 */

/**
 * Handle executable code block button clicks
 * Sends the code content back to Claude for execution
 */
export async function handleExecutableCodeBlock(
  actionId: string,
  userId: string,
  channelId: string,
  messageTs: string,
  body: any,
  client: any,
  handleUserRequestFn: (
    context: any,
    userInput: string,
    client: any
  ) => Promise<void>
): Promise<void> {
  logger.info(`Handling executable code block: ${actionId}`);

  try {
    // Extract the code from the button's value
    const action = (body as any).actions?.[0];
    if (!action?.value) {
      throw new Error("No code content found in button");
    }

    const codeContent = action.value;
    const language = actionId.split("_")[0]; // Extract language from action_id
    const buttonText = action.text?.text || `Run ${language}`;

    // Post the code execution request as a user message
    const formattedInput = `> 🚀 *Executed "${buttonText}" button*\n\n\`\`\`${language}\n${codeContent}\n\`\`\``;

    // Get the actual thread_ts from the message (messageTs is where button was clicked)
    // If message has thread_ts, use it; otherwise this IS the thread root
    const actualThreadTs = (body as any).message?.thread_ts || messageTs;

    const inputMessage = await client.chat.postMessage({
      channel: channelId,
      thread_ts: actualThreadTs,
      text: formattedInput,
      blocks: [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `<@${userId}> executed "${buttonText}" button`,
            },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `\`\`\`${language}\n${codeContent}\n\`\`\``,
          },
        },
      ],
    });

    const context = {
      channelId,
      userId,
      userDisplayName: (body as any).user?.name || "Unknown User",
      teamId: (body as any).team?.id || "",
      messageTs: inputMessage.ts as string,
      threadTs: actualThreadTs,
      text: formattedInput,
    };

    await handleUserRequestFn(context, formattedInput, client);
  } catch (error) {
    logger.error(`Failed to handle executable code block ${actionId}:`, error);
    const actualThreadTs = (body as any)?.message?.thread_ts || messageTs;
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: actualThreadTs,
      text: `❌ Failed to execute code: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }
}

/**
 * Handle blockkit form button clicks
 * Opens a modal with the blockkit form content
 */
export async function handleBlockkitForm(
  actionId: string,
  _userId: string,
  channelId: string,
  messageTs: string,
  body: any,
  client: any
): Promise<void> {
  logger.info(`Handling blockkit form: ${actionId}`);

  try {
    // Extract the blocks from the button's value
    const action = (body as any).actions?.[0];
    if (!action?.value) {
      logger.error(`No form data found in button for action ${actionId}`);
      throw new Error("No form data found in button");
    }

    let formData;
    try {
      formData = JSON.parse(action.value);
    } catch (parseError) {
      logger.error(
        `Failed to parse form data for action ${actionId}:`,
        parseError
      );
      logger.error(`Raw value: ${action.value}`);
      throw new Error(`Invalid JSON in form data: ${parseError}`);
    }

    const blocks = formData.blocks || [];

    if (blocks.length === 0) {
      logger.error(`No blocks found in form data for action ${actionId}`);
      throw new Error("No blocks found in form data");
    }

    // Check if trigger_id exists
    if (!body.trigger_id) {
      logger.error(`No trigger_id in body for action ${actionId}`);
      throw new Error("No trigger_id available - cannot open modal");
    }

    // Get the actual thread_ts from the message (messageTs is where button was clicked)
    // If message has thread_ts, use it; otherwise this IS the thread root
    const actualThreadTs = (body as any).message?.thread_ts || messageTs;

    logger.info(
      `Opening modal for action ${actionId}, trigger_id: ${body.trigger_id}`
    );

    // Create modal with the blockkit form
    const modalResult = await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "blockkit_form_modal",
        private_metadata: JSON.stringify({
          channel_id: channelId,
          thread_ts: actualThreadTs,
          action_id: actionId,
          button_text: action.text?.text || "Form",
        }),
        title: { type: "plain_text", text: action.text?.text || "Form" },
        submit: { type: "plain_text", text: "Submit" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: blocks,
      },
    });

    logger.info(
      `Modal opened successfully for action ${actionId}, ok: ${modalResult.ok}`
    );
  } catch (error: any) {
    logger.error(`Failed to handle blockkit form ${actionId}:`, {
      error: error.message,
      data: error.data,
      code: error.code,
      stack: error.stack,
    });

    // Show the raw Block Kit content for troubleshooting
    const rawBlocksJson = JSON.stringify(body, null, 2);
    const truncatedBlocks =
      rawBlocksJson.length > 2500
        ? `${rawBlocksJson.substring(0, 2500)}\n...[truncated]`
        : rawBlocksJson;

    const actualThreadTs = (body as any)?.message?.thread_ts || messageTs;
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: actualThreadTs,
      text: `❌ Failed to open form: ${error instanceof Error ? error.message : "Unknown error"}\n\nRaw Block Kit (truncated):\n\`\`\`json\n${truncatedBlocks}\n\`\`\`\n\nTip: Some blocks are not modal-compatible.`,
    });
  }
}

/**
 * Handle stop worker button clicks
 * Scales the deployment to 0 to stop the Claude worker
 */
export async function handleStopWorker(
  deploymentName: string,
  userId: string,
  channelId: string,
  messageTs: string,
  client: any
): Promise<void> {
  logger.info(`Handling stop worker request for deployment: ${deploymentName}`);

  try {
    // Make API call to orchestrator to scale deployment to 0
    const orchestratorUrl =
      process.env.ORCHESTRATOR_URL || "http://peerbot-orchestrator:8080";
    const response = await fetch(
      `${orchestratorUrl}/scale/${deploymentName}/0`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestedBy: userId,
          reason: "User requested stop via Slack button",
        }),
      }
    );

    if (response.ok) {
      // Success - notify user in thread
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: `✅ Claude worker stopped successfully. The deployment "${deploymentName}" has been scaled to 0.`,
      });

      // Update the original message to remove the stop button
      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: "Claude worker has been stopped by user request.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "🛑 *Claude worker stopped by user request*",
            },
          },
        ],
      });
    } else {
      const errorText = await response.text();
      throw new Error(
        `Orchestrator responded with ${response.status}: ${errorText}`
      );
    }
  } catch (error) {
    logger.error(
      `Failed to stop worker for deployment ${deploymentName}:`,
      error
    );
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      text: `❌ Failed to stop Claude worker: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }
}
