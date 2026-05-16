module.exports = {
    name: 'setdj',
    description: 'Sets the DJ role for the server.',
    async execute(message, args) {
        if (!message.member.permissions.has('ManageGuild')) {
            return message.reply('❌ You need **Manage Server** permissions to use this command.');
        }

        const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);

        if (!role) {
            return message.reply('❌ Please mention a role or provide a valid Role ID. Usage: `!setdj @Role`');
        }

        message.client.guildConfigs.update(message.guild.id, 'djRoleId', role.id);

        message.reply(`✅ Successfully set the DJ role to **${role.name}**.`);
    }
};
