export type AlertableUser = {
    friendlyName: string,
    userId: string,
    enabled: boolean,
    title: string,
    message: string,
    alertOnWebhook: string,
    alertOffWebhook: string,
    allowedRoles: string[]
};

export type HASSAlertConfig = {
    commandName: string,
    description: string,
    alertableUsers: AlertableUser[]
}
