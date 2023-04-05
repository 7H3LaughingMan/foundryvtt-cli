import Config from "../config.mjs";
import {ClassicLevel} from "classic-level";
import yaml from "js-yaml";
import path from "path";
import fs from "fs";

/**
 * Get the command object for the package command
 * @returns {{handler: ((function(*): Promise<void>)|*), builder: builder, describe: string, command: string}}
 */
export function getCommand() {
    let currentPackageId = Config.instance.get("currentPackageId");
    let currentPackageType = Config.instance.get("currentPackageType");

    return {
        command: "package [action] [value]",
        describe: "Manage packages",
        builder: (yargs) => {
            yargs.positional("action", {
                describe: "The action to perform",
                type: "string",
                choices: ["workon", "clear", "unpack", "pack"]
            });

            yargs.positional("value", {
                describe: "The value to use for the action",
                type: "string"
            });

            // If no currentPackageId is set and the action is not "clear", require an `id` option to be set
            yargs.option("id", {
                describe: "The package ID",
                type: "string",
                demandOption: currentPackageId === null,
            });

            yargs.option("type", {
                describe: "The package type",
                type: "string",
                choices: ["Module", "System", "World"]
            });

            yargs.option("compendiumName", {
                alias: "n",
                describe: "The Compendium name, for Compendium Pack based Actions.",
                type: "string"
            });

            yargs.option("directory", {
                alias: "d",
                describe: "The directory to serialize to / from, for Pack based Actions.",
                type: "string"
            });

            yargs.option("yaml", {
                describe: "Whether to use YAML instead of JSON for serialization.",
                type: "boolean"
            });

            yargs.option("verbose", {
                alias: "v",
                describe: "Whether to output verbose logging.",
                type: "boolean"
            });
        },
        handler: async (argv) => {
            if ( argv.id ) {
                currentPackageId = argv.id;
            }
            if ( argv.type ) {
                currentPackageType = argv.type;
            }

            // Handle actions
            switch ( argv.action ) {
                case "workon": {
                    _handleWorkon(argv);
                    break;
                }

                case "clear": {
                    _handleClear();
                    break;
                }

                case "unpack": {
                    await _handleUnpack(argv);
                    break;
                }

                case "pack": {
                    await _handlePack(argv);
                    break;
                }

                default: {
                    if ( !currentPackageId ) {
                        console.error("No package ID is currently set. Use `package workon <id>` to set it.");
                        return;
                    }
                    console.log(`Currently in ${currentPackageType} ${currentPackageId}`);
                    break;
                }
            }
        }
    }

    /* -------------------------------------------- */

    /**
     * Set the current package ID and type
     * @param {Object} argv                  The command line arguments
     * @private
     */
    function _handleWorkon(argv) {
        if ( argv.value ) {
            currentPackageId = argv.value;
        }
        Config.instance.set("currentPackageId", currentPackageId);

        if ( !argv.type ) {
            const game = discoverPackageDirectory(argv);
            const pkgCount = game.packages.filter(p => p[0] === currentPackageId).length;
            if ( pkgCount > 1 ) {
                console.error(`Multiple packages with ID ${currentPackageId} found. Please specify the package type with --type`);
                return;
            }
            const pkg = game.worlds.get(currentPackageId) ?? game.systems.get(currentPackageId) ?? game.modules.get(currentPackageId);
            if ( !pkg ) {
                console.error(`No package with ID ${currentPackageId} found.`);
                return;
            }
            currentPackageType = pkg.type;
        }

        Config.instance.set("currentPackageType", currentPackageType);
        console.log(`Swapped to ${currentPackageType} ${currentPackageId}`);
    }

    /* -------------------------------------------- */

    /**
     * Clear the current package ID and type
     * @private
     */
    function _handleClear() {
        currentPackageId = null;
        currentPackageType = null;
        Config.instance.set("currentPackageId", currentPackageId);
        Config.instance.set("currentPackageType", currentPackageType);
        console.log("Cleared current Package");
    }

    /* -------------------------------------------- */

    /**
     * Normalize a path to use POSIX separators
     * @param {string} pathToNormalize      The path to normalize
     * @returns {string}
     */
    function normalizePath(pathToNormalize) {
        return path.normalize(pathToNormalize).split(path.sep).join(path.posix.sep);
    }

    /* -------------------------------------------- */

    /**
     * Discover the list of all Packages in the dataPath
     * @param {Object} argv                  The command line arguments
     * @returns {*}
     */
    function discoverPackageDirectory(argv) {
        const dataPath = Config.instance.get("dataPath");
        if ( !dataPath ) {
            console.error("No dataPath configured. Call `configure set dataPath <path>` first.");
            return;
        }

        const modulesDir = normalizePath(`${dataPath}/modules`);
        const systemsDir = normalizePath(`${dataPath}/systems`);
        const worldsDir = normalizePath(`${dataPath}/worlds`);

        const game = {
            modules: new Map(),
            systems: new Map(),
            worlds: new Map(),
            packages: new Map()
        };

        // For each dir, find all subdirectories and their system.json, module.json, or world.json
        for ( const module of fs.readdirSync(modulesDir, {withFileTypes: true}) ) {
            // Find the module.json file
            const modulePath = normalizePath(`${modulesDir}/${module.name}/module.json`);
            if ( fs.existsSync(modulePath) ) {
                // Read the module.json file
                try {
                    const moduleData = JSON.parse(fs.readFileSync(modulePath, "utf8"));
                    moduleData.type = "Module";
                    game.modules.set(moduleData.id ?? moduleData.name, moduleData);
                }
                catch (e) {
                    if ( argv.verbose ) console.error(`Error reading module.json for ${module.name}: ${e}`);
                }
            }
        }
        for ( const system of fs.readdirSync(systemsDir, {withFileTypes: true}) ) {
            // Find the system.json file
            const systemPath = normalizePath(`${systemsDir}/${system.name}/system.json`);
            if ( fs.existsSync(systemPath) ) {
                // Read the system.json file
                try {
                    const systemData = JSON.parse(fs.readFileSync(systemPath, "utf8"));
                    systemData.type = "System";
                    game.systems.set(systemData.id ?? systemData.name, systemData);
                }
                catch (e) {
                    if ( argv.verbose ) console.error(`Error reading system.json for ${system.name}: ${e}`);
                }
            }
        }
        for ( const world of fs.readdirSync(worldsDir, {withFileTypes: true}) ) {
            // Find the world.json file
            const worldPath = normalizePath(`${worldsDir}/${world.name}/world.json`);
            if ( fs.existsSync(worldPath) ) {
                // Read the world.json file
                try {
                    const worldData = JSON.parse(fs.readFileSync(worldPath, "utf8"));
                    worldData.type = "World";
                    game.worlds.set(worldData.id ?? worldData.name, worldData);
                }
                catch (e) {
                    if ( argv.verbose ) console.error(`Error reading world.json for ${world.name}: ${e}`);
                }
            }
        }

        game.packages = [...game.modules, ...game.systems, ...game.worlds];

        return game;
    }

    /* -------------------------------------------- */

    function isFileLocked(filepath) {
        try {
            // Try to open the file with the 'w' flag, which requests write access
            const fd = fs.openSync(filepath, 'w');

            // If the file was successfully opened, it is not locked
            fs.closeSync(fd);
            return false;
        } catch (err) {
            // If the file could not be opened, it is locked
            if (err.code === 'EBUSY') {
                return true;
            } else {
                throw err;
            }
        }
    }

    /* -------------------------------------------- */

    /**
     * Load a pack from a directory and serialize the DB entries, each to their own file
     * @param {Object} argv                  The command line arguments
     * @returns {Promise<void>}
     * @private
     */
    async function _handleUnpack(argv) {
        const typeDir = currentPackageType.toLowerCase() + "s";
        const compendiumName = argv.compendiumName ?? argv.value;
        if ( !compendiumName ) {
            console.error("No Compendium Name provided for the `unpack` action. Try again with `-n <name>`.");
            return;
        }

        const dataPath = Config.instance.get("dataPath");
        if ( !dataPath ) {
            console.error("No dataPath configured. Call `configure set dataPath <path>` first.");
            return;
        }

        const packDir = normalizePath(`${dataPath}/${typeDir}/${currentPackageId}/packs/${compendiumName}`);
        const outputDir = normalizePath(argv.directory ?? `${dataPath}/${typeDir}/${currentPackageId}/packs/${compendiumName}/_source`);

        if ( isFileLocked(packDir + "/LOCK") ) {
            console.error(`The pack "${packDir}" is currently in use by Foundry VTT. Please close Foundry VTT and try again.`);
            return;
        }

        console.log(`Writing pack "${packDir}" to "${outputDir}"`);

        try {
            // Load the directory as a ClassicLevel db
            const db = new ClassicLevel(packDir, {keyEncoding: "utf8", valueEncoding: "json"});
            const keys = await db.keys().all();

            // Iterate over all entries in the db, writing them as individual YAML files
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, {recursive: true});
            }
            for await (const [key, value] of db.iterator()) {
                const name = value.name ? `${value.name.toLowerCase().replaceAll(" ", "_")}_${value._id}` : key;
                value._key = key;
                let fileName;
                if ( argv.yaml ) {
                    fileName = `${outputDir}/${name}.yml`;
                    fs.writeFileSync(fileName, yaml.dump(value));
                }
                else {
                    fileName = `${outputDir}/${name}.json`;
                    fs.writeFileSync(fileName, JSON.stringify(value, null, 2));
                }
                console.log(`Wrote ${fileName}`);
            }
            await db.close();
        }
        catch (err) {
            console.error(err);
        }
    }

    /* -------------------------------------------- */

    /**
     * Read serialized files from a directory and write them to a pack db
     * @param {Object} argv                  The command line arguments
     * @returns {Promise<void>}
     * @private
     */
    async function _handlePack(argv) {
        const typeDir = currentPackageType.toLowerCase() + "s";

        const compendiumName = argv.compendiumName ?? argv.value;
        if ( !compendiumName ) {
            console.error("No Compendium Name provided for the `pack` action. Try again with `-n <name>`.");
            return;
        }

        const dataPath = Config.instance.get("dataPath");
        if ( !dataPath ) {
            console.error("No dataPath configured. Call `configure set dataPath <path>` first.");
            return;
        }
        const packDir = normalizePath(`${dataPath}/${typeDir}/${currentPackageId}/packs/${compendiumName}`);
        const inputDir = normalizePath(argv.directory ?? `${dataPath}/${typeDir}/${currentPackageId}/packs/${compendiumName}/_source`);

        if ( isFileLocked(packDir + "/LOCK") ) {
            console.error(`The pack "${packDir}" is currently in use by Foundry VTT. Please close Foundry VTT and try again.`);
            return;
        }

        console.log(`Packing "${inputDir}" into pack "${packDir}"`);

        try {
            // Load the directory as a ClassicLevel db
            const db = new ClassicLevel(packDir, {keyEncoding: "utf8", valueEncoding: "json"});
            const batch = db.batch();

            // Iterate over all YAML files in the input directory, writing them to the db
            const files = fs.readdirSync(inputDir);
            const seenKeys = new Set();
            for ( const file of files ) {
                const fileContents = fs.readFileSync(path.join(inputDir, file));
                const value = file.endsWith(".yml") ? yaml.load(fileContents) : JSON.parse(fileContents);
                const key = value._key;
                delete value._key;
                seenKeys.add(key);
                batch.put(key, value);
                console.log(`Packed ${value._id}${value.name ? ` (${value.name})` : ""}`);
            }

            // Remove any entries in the db that are not in the input directory
            for ( const key of await db.keys().all() ) {
                if ( !seenKeys.has(key) ) {
                    batch.del(key);
                    console.log(`Removed ${key}`);
                }
            }
            await batch.write();
            await db.close();
        }
        catch (err) {
            console.error(err);
        }
    }
}
