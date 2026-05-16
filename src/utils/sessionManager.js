class SessionManager {
    /**
     * Checks if a member has permission to control music (Skip, Pause, Volume, etc.)
     */
    canControl(member, player, guildConfig) {
        if (!player) return false;
        
        const isRequester = player.queue.current?.requester?.id === member.id;
        const isDJ = guildConfig.djRoleId ? member.roles.cache.has(guildConfig.djRoleId) : false;
        const isAdmin = member.permissions.has('ManageGuild');
        const isSolo = member.voice.channel?.members.filter(m => !m.user.bot).size === 1;

        return isAdmin || isDJ || isRequester || isSolo;
    }

    /**
     * Checks if a member can add songs to the queue.
     * Respects the session lock status.
     */
    canAddSongs(member, player, guildConfig) {
        // If not locked, everyone in VC can add
        if (!guildConfig.isLocked) return true;

        // If locked, only DJs, Admins, or the person who started the current song can add
        return this.canControl(member, player, guildConfig);
    }

    /**
     * Checks if a member can manage bot settings (like changing DJ role or locking session)
     */
    canManageSettings(member) {
        const isAdmin = member.permissions.has('ManageGuild');
        const isMod = member.roles.cache.some(r => r.name.toLowerCase().includes('mod'));

        return isAdmin || isMod;
    }
}

module.exports = new SessionManager();
