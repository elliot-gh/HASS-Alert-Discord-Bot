import { GatewayIntentBits, SlashCommandBuilder, ContextMenuCommandBuilder, CommandInteraction, APIApplicationCommandOptionChoice, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { BotWithConfig } from "../../BotWithConfig";
import { AlertableUser, HASSAlertConfig } from "./HASSAlertConfig";
import { HASSWebhookProcessor } from "./HASSWebhookProcessor";

type ActiveAlertMessage = {
    messageId: string,
    channelId: string
}

type UserIdToAlertMessage = {
    [userId: string]: ActiveAlertMessage | null
}

type UserIdToConfig = {
    [userId: string]: AlertableUser
}

export class HASSAlertBot extends BotWithConfig {

    intents: GatewayIntentBits[];
    commands: (SlashCommandBuilder | ContextMenuCommandBuilder)[];

    private readonly config: HASSAlertConfig;
    private readonly webhookProcessor: HASSWebhookProcessor;
    private readonly slashAlert: SlashCommandBuilder;
    private readonly slashStop: SlashCommandBuilder;
    private readonly activeAlertMessages: UserIdToAlertMessage;
    private readonly userConfig: UserIdToConfig;

    constructor() {
        super("HASSAlertBot", import.meta);
        this.config = this.readYamlConfig<HASSAlertConfig>("config.yaml");
        this.intents = [GatewayIntentBits.Guilds | GatewayIntentBits.DirectMessages];
        this.webhookProcessor = new HASSWebhookProcessor(this.config);
        this.activeAlertMessages = {};
        this.userConfig = {};
        const choices: APIApplicationCommandOptionChoice<string>[] = [];
        for (const user of this.config.alertableUsers) {
            this.userConfig[user.userId] = user;
            choices.push({
                name: user.friendlyName,
                value: user.userId
            } as APIApplicationCommandOptionChoice<string>);
            this.activeAlertMessages[user.userId] = null;
        }

        this.slashAlert = new SlashCommandBuilder()
            .setName(this.config.commandName)
            .setDescription(this.config.description)
            .setDMPermission(false)
            .addStringOption(option =>
                option
                    .setName("name")
                    .setDescription("Who to alert")
                    .setMinLength(1)
                    .setRequired(true)
                    .addChoices(...choices)
            ) as SlashCommandBuilder;

        this.slashStop = new SlashCommandBuilder()
            .setName("stop")
            .setDescription("Stop an alert running on yourself")
            .setDMPermission(false)
            .addStringOption(option =>
                option
                    .setName("code")
                    .setDescription("The code to disable the alert")
                    .setMinLength(1)
                    .setRequired(true)
            ) as SlashCommandBuilder;

        this.commands = [this.slashAlert, this.slashStop];
    }

    async processCommand(interaction: CommandInteraction): Promise<void> {
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case this.slashAlert.name:
                    await this.processSlashAlert(interaction);
                    break;
                case this.slashStop.name:
                    await this.processSlashStop(interaction);
                    break;
                default:
                    return;
            }
        }
    }

    private async processSlashAlert(interaction: ChatInputCommandInteraction): Promise<void> {
        this.logger.info(`processSlashAlert() called by ${interaction.user.id}`);
        try {
            const targetUserId = interaction.options.getString("name", true);
            this.logger.info(`${interaction.user.id} is trying to enable alert for user ${targetUserId}`);
            if (targetUserId === interaction.user.id) {
                this.logger.error(`User ${interaction.user.id} tried to enable alert for themselves`);
                await interaction.reply({
                    embeds: [HASSAlertBot.buildErrorEmbed("Error enabling alert", "You cannot enable an alert for yourself")],
                    ephemeral: true
                });
                return;
            } else if (interaction.member === null) {
                this.logger.error(`Unable to get roles for user ${interaction.user.id}`);
                await interaction.reply({
                    embeds: [HASSAlertBot.buildErrorEmbed("Error enabling alert", "Unable to get your roles")],
                    ephemeral: true
                });
                return;
            }

            const callerRoles = interaction.member.roles;
            let roleFound = false;
            if (Array.isArray(callerRoles)) {
                roleFound = callerRoles.some(role => this.userConfig[targetUserId].allowedRoles.includes(role));
            } else {
                roleFound = callerRoles.cache.some(role => this.userConfig[targetUserId].allowedRoles.includes(role.id));
            }

            if (!roleFound) {
                this.logger.error(`User ${interaction.user.id} does not have permission to enable alert for user ${targetUserId}`);
                await interaction.reply({
                    embeds: [HASSAlertBot.buildErrorEmbed("Error enabling alert", "You do not have the correct role to enable this alert")],
                    ephemeral: true
                });
                return;
            }

            const result = await this.webhookProcessor.enableAlert(targetUserId);
            if (typeof(result) === "string") {
                this.logger.error(`Error enabling alert for user ${targetUserId}: ${result}`);
                await interaction.reply({
                    embeds: [HASSAlertBot.buildErrorEmbed("Error enabling alert", `${result}`)],
                    ephemeral: true
                });
                return;
            }

            const disableCode = result.disableCode;
            const embed = new EmbedBuilder()
                .setTitle("Alert enabled")
                .setDescription(`You have enabled an alert for <@${targetUserId}>.\n`
                    + `To disable it, <@${targetUserId}> must use command \`/${this.slashStop.name}\` with the following code: \`${disableCode}\``)
                .setColor(0x00FF00);

            const replyInteraction = await interaction.reply({
                content: `<@${targetUserId}>`,
                embeds: [embed]
            });
            const replyMsg = await replyInteraction.fetch();

            this.activeAlertMessages[targetUserId] = {
                messageId: replyMsg.id,
                channelId: replyMsg.channelId
            };
        } catch (error) {
            this.logger.error(`Error enabling alert called by user ${interaction.user.id}: ${error}`);
            if (!interaction.replied) {
                await interaction.reply({
                    embeds: [HASSAlertBot.buildErrorEmbed("Unknown error while enabling alert", `${error}`)],
                    ephemeral: true
                });
            }
        }
    }

    private async processSlashStop(interaction: ChatInputCommandInteraction): Promise<void> {
        this.logger.info(`processSlashStop() called by ${interaction.user.id}`);
        try {
            const disableCode = interaction.options.getString("code", true);
            this.logger.info(`${interaction.user.id} is trying to disable alert with code ${disableCode}`);
            const result = await this.webhookProcessor.disableAlert(interaction.user.id, disableCode);
            if (typeof(result) === "string") {
                this.logger.error(`Error disabling alert for user ${interaction.user.id}: ${result}`);
                await interaction.reply({
                    embeds: [HASSAlertBot.buildErrorEmbed("Error disabling alert", `${result}`)],
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle("Alert disabled")
                .setDescription("You have disabled your alert.")
                .setColor(0x00FF00);

            await interaction.reply({
                embeds: [embed]
            });

            const alertMsg = this.activeAlertMessages[interaction.user.id];
            if (alertMsg === null) {
                this.logger.warn(`No alert message found for user ${interaction.user.id}`);
                return;
            }

            const channel = await interaction.client.channels.fetch(alertMsg.channelId);
            if (channel === null || !channel.isTextBased()) {
                this.logger.warn(`Unable to fetch channel ${alertMsg.channelId}`);
                return;
            }

            const message = await channel.messages.fetch(alertMsg.messageId);
            const editEmbed = new EmbedBuilder()
                .setTitle("Alert disabled")
                .setDescription(`<@${interaction.user.id}> has disabled their alert.`)
                .setColor(0x33E7F7);
            await message.edit({
                content: "",
                embeds: [editEmbed]
            });
        } catch (error) {
            this.logger.error(`Error disabling alert called by user ${interaction.user.id}: ${error}`);
            if (!interaction.replied) {
                await interaction.reply({
                    embeds: [HASSAlertBot.buildErrorEmbed("Unknown error while disabling alert", `${error}`)],
                    ephemeral: true
                });
            }
        }
    }

    private static buildErrorEmbed(title: string, reason: string): EmbedBuilder {
        return new EmbedBuilder()
            .setTitle(title)
            .setDescription(reason)
            .setColor(0xFF0000);
    }

    getSlashCommands(): (SlashCommandBuilder | ContextMenuCommandBuilder)[] {
        return this.commands;
    }

    getIntents(): GatewayIntentBits[] {
        return this.intents;
    }
}