import axios from "axios";
import { AlertableUser, HASSAlertConfig } from "./HASSAlertConfig";
import { createLogger } from "../../utils/Logger";
import { Logger } from "winston";

type WebhookPayload = {
    title: string,
    message: string
}

type UserIdToWebhook = {
    [userId: string]: AlertableUser
}

type ActiveUser = {
    enabled: boolean,
    disableCode: string
}

type ActiveAlerts = {
    [userId: string]: ActiveUser
}

export class HASSWebhookProcessor {
    private readonly logger: Logger;
    private readonly userWebhooks: UserIdToWebhook;
    private readonly activeAlerts: ActiveAlerts;

    constructor(config: HASSAlertConfig) {
        this.logger = createLogger("HASSWebhookProcessor");
        this.userWebhooks = {};
        this.activeAlerts = {};
        for (const user of config.alertableUsers) {
            this.userWebhooks[user.userId] = user;
            this.activeAlerts[user.userId] = {
                enabled: false,
                disableCode: ""
            };
        }
    }

    async enableAlert(userId: string): Promise<ActiveUser | string> {
        if (!(userId in this.userWebhooks)) {
            return `User <@${userId}> is not configured for alerts`;
        } else if (!this.userWebhooks[userId].enabled) {
            return `Alerts configuration is disabled for user <@${userId}>`;
        } else if (this.activeAlerts[userId].enabled) {
            return `Alert is already enabled for user <@${userId}>`;
        }

        const payload: WebhookPayload = {
            title: this.userWebhooks[userId].title,
            message: this.userWebhooks[userId].message
        };

        this.logger.info(`Calling enable alert webhook user ${userId} with payload ${JSON.stringify(payload)}`);
        const url = this.userWebhooks[userId].alertOnWebhook;
        const response = await axios.post(url, payload);
        if (response.status !== 200) {
            this.logger.error(`Enable webhook did not return 200 for user ${userId}`);
            return `Enable webhook did not return 200 for user ${userId}`;
        }

        const activeUser: ActiveUser = {
            enabled: true,
            disableCode: HASSWebhookProcessor.generateDisableCode()
        };

        this.logger.info(`Enabled alert for user ${userId} with disable code ${activeUser.disableCode}`);
        this.activeAlerts[userId] = activeUser;
        return activeUser;
    }

    async disableAlert(userId: string, disableCode: string): Promise<ActiveUser | string> {
        if (!(userId in this.userWebhooks)) {
            return `User <@${userId}> is not configured for alerts`;
        } else if (!this.userWebhooks[userId].enabled) {
            return `Alerts configuration is disabled for user <@${userId}>`;
        } else if (!this.activeAlerts[userId].enabled) {
            return `No active alert for user <@${userId}>`;
        }

        const activeUser = this.activeAlerts[userId];
        if (disableCode !== activeUser.disableCode) {
            this.logger.info(`Invalid disable code \`${disableCode}\` for user <@${userId}>; correct is \`${activeUser.disableCode}\``);
            return `Invalid disable code \`${disableCode}\` for user <@${userId}>; correct is \`${activeUser.disableCode}\``;
        }

        this.logger.info(`Calling disable alert webhook user ${userId}`);
        const url = this.userWebhooks[userId].alertOffWebhook;
        const response = await axios.post(url);
        if (response.status !== 200) {
            this.logger.error(`Disable webhook did not return 200 for user ${userId}`);
            return `Disable webhook did not return 200 for user ${userId}`;
        }

        this.logger.info(`Disabled alert for user ${userId}`);
        this.activeAlerts[userId] = {
            enabled: false,
            disableCode: ""
        };
        return this.activeAlerts[userId];
    }

    private static generateDisableCode(): string {
        return Math.random().toString(36).slice(2);
    }
}
