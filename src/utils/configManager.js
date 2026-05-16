const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../../guildConfigs.json');

class ConfigManager {
    constructor() {
        this.configs = new Map();
        this.load();
    }

    load() {
        if (fs.existsSync(configPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                this.configs = new Map(Object.entries(data));
            } catch (e) {
                console.error('Failed to load guildConfigs.json');
            }
        }
    }

    save() {
        const data = Object.fromEntries(this.configs);
        fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
    }

    get(guildId) {
        if (!this.configs.has(guildId)) {
            this.configs.set(guildId, {
                djRoleId: null,
                isLocked: false
            });
            this.save();
        }
        return this.configs.get(guildId);
    }

    update(guildId, key, value) {
        const config = this.get(guildId);
        config[key] = value;
        this.configs.set(guildId, config);
        this.save();
    }
}

module.exports = new ConfigManager();
