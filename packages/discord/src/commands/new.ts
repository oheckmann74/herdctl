import type { CommandContext, SlashCommand } from "./types.js";

export const newCommand: SlashCommand = {
  name: "new",
  description: "Start a fresh conversation (clear current session)",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, sessionManager, commandActions, agentName } = context;
    const channelId = interaction.channelId;

    const wasCleared = await sessionManager.clearSession(channelId);

    // Also clear the core herdctl session to prevent stale Docker session references
    if (commandActions?.clearCoreSession) {
      await commandActions.clearCoreSession();
    }

    await interaction.reply({
      embeds: [
        {
          description: wasCleared
            ? "Started a new conversation. Previous session context was cleared."
            : "Started a new conversation. No previous session was active.",
          color: 0x22c55e,
          footer: { text: `herdctl · ${agentName}` },
        },
      ],
      ephemeral: true,
    });
  },
};
