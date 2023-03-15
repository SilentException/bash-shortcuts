import { ServerAPI } from "decky-frontend-lib";
import { ShortcutsController } from "./ShortcutsController";
import { InstancesController } from "./InstancesController";
import { PyInterop } from "../../PyInterop";
import { SteamController } from "./SteamController";
import { Shortcut } from "../data-structures/Shortcut";
import { WebSocketClient } from "../../WebsocketClient";
import { HookController } from "./HookController";
import { ShortcutsState } from "../../state/ShortcutsState";

/**
 * Main controller class for the plugin.
 */
export class PluginController {
  static mainAppId: number;
  static shortcutName: string;
  static runnerPath = "\"/home/deck/homebrew/plugins/bash-shortcuts/shortcutsRunner.sh\"";
  static startDir = "\"/home/deck/homebrew/plugins/bash-shortcuts/\"";

  // @ts-ignore
  private static server: ServerAPI;
  private static steamController: SteamController;
  private static shortcutsController: ShortcutsController;
  private static instancesController: InstancesController;
  private static hooksController: HookController;
  private static webSocketClient: WebSocketClient;
  private static state: ShortcutsState;

  /**
   * Sets the plugin's serverAPI.
   * @param server The serverAPI to use.
   */
  static setup(server: ServerAPI, state: ShortcutsState): void {
    this.server = server;
    this.state = state;
    this.steamController = new SteamController();
    this.shortcutsController = new ShortcutsController(this.steamController);
    this.webSocketClient = new WebSocketClient("localhost", "5000", 1000);
    this.instancesController = new InstancesController(this.shortcutsController, this.webSocketClient);
    this.hooksController = new HookController(this.steamController, this.instancesController);
  }

  /**
   * Sets the plugin to initialize once the user logs in.
   * @returns The unregister function for the login hook.
   */
  static initOnLogin(): Unregisterer {
    PyInterop.getHomeDir().then((res) => {
      PluginController.runnerPath = `\"/home/${res.result}/homebrew/plugins/bash-shortcuts/shortcutsRunner.sh\"`;
      PluginController.startDir = `\"/home/${res.result}/homebrew/plugins/bash-shortcuts/\"`;
    });

    return this.steamController.registerForAuthStateChange(async (username) => {
      PyInterop.log(`user logged in. [DEBUG INFO] username: ${username};`);
      if (await this.steamController.waitForServicesToInitialize()) {
        PluginController.init("Bash Shortcuts");
      } else {
        PyInterop.toast("Error", "Failed to initialize, try restarting.");
      }
    }, null, true);
  }

  /**
   * Initializes the Plugin.
   * @param name The name of the main shortcut.
   */
  static async init(name: string): Promise<void> {
    PyInterop.log("PluginController initializing...");
    this.shortcutName = name;

    //* clean out all shortcuts with names that start with "Bash Shortcuts - Instance"
    const oldInstances = (await this.shortcutsController.getShortcuts()).filter((shortcut:SteamAppDetails) => shortcut.strDisplayName.startsWith("Bash Shortcuts - Instance"));

    if (oldInstances.length > 0) {
      for (const instance of oldInstances) {
        await this.shortcutsController.removeShortcutById(instance.unAppID);
      }
    }

    this.webSocketClient.connect();

    const shortcuts = (await PyInterop.getShortcuts()).result;
    if (typeof shortcuts === "string") {
      PyInterop.log(`Failed to get shortcuts for hooks. Error: ${shortcuts}`);
    } else {
      this.hooksController.init(shortcuts);
    }
    
    PyInterop.log("PluginController initialized.");
  }

  /**
   * Gets a shortcut by its id.
   * @param shortcutId The id of the shortcut to get.
   * @returns The shortcut.
   */
  static getShortcutById(shortcutId: string): Shortcut {
    return this.state.getPublicState().shortcuts[shortcutId];
  }

  /**
   * Sets wether a shortcut is running or not.
   * @param shortcutId The id of the shortcut to set.
   * @param value The new value.
   */
  static setIsRunning(shortcutId: string, value: boolean): void {
    this.state.setIsRunning(shortcutId, value);
  }

  /**
   * Launches a steam shortcut.
   * @param shortcutName The name of the steam shortcut to launch.
   * @param shortcut The shortcut to launch.
   * @param runnerPath The runner path for the shortcut.
   * @param onExit An optional function to run when the instance closes.
   * @returns A promise resolving to true if the shortcut was successfully launched.
   */
  static async launchShortcut(shortcut: Shortcut, onExit: (data?: LifetimeNotification) => void = () => {}): Promise<boolean> {
    const createdInstance = await this.instancesController.createInstance(PluginController.shortcutName, shortcut, PluginController.runnerPath, PluginController.startDir);
    if (createdInstance) {
      PyInterop.log(`Created Instance for shortcut ${shortcut.name}`);
      return await this.instancesController.launchInstance(shortcut.id, onExit);
    } else {
      return false;
    }
  }

  /**
   * Closes a running shortcut.
   * @param shortcut The shortcut to close.
   * @returns A promise resolving to true if the shortcut was successfully closed.
   */
  static async closeShortcut(shortcut:Shortcut): Promise<boolean> {
    const stoppedInstance = await this.instancesController.stopInstance(shortcut.id);
    if (stoppedInstance) {
      PyInterop.log(`Stopped Instance for shortcut ${shortcut.name}`);
      return await this.instancesController.killInstance(shortcut.id);
    } else {
      PyInterop.log(`Failed to stop instance for shortcut ${shortcut.name}. Id: ${shortcut.id}`);
      return false;
    }
  }

  /**
   * Kills a shortcut's instance.
   * @param shortcut The shortcut to kill.
   * @returns A promise resolving to true if the shortcut's instance was successfully killed.
   */
  static async killShortcut(shortcut: Shortcut): Promise<boolean> {
    return await this.instancesController.killInstance(shortcut.id);
  }

  /**
   * Checks if a shortcut is running.
   * @param shorcutId The id of the shortcut to check for.
   * @returns True if the shortcut is running.
   */
  static checkIfRunning(shorcutId: string): boolean {
    return Object.keys(PluginController.instancesController.instances).includes(shorcutId);
  }

  /**
   * Registers a callback to run when WebSocket messages of a given type are recieved.
   * @param type The type of message to register for.
   * @param callback The callback to run.
   */
  static onWebSocketEvent(type: string, callback: (data: any) => void) {
    this.webSocketClient.on(type, callback);
  }

  /**
   * Updates the hooks for a specific shortcut.
   * @param shortcut The shortcut to update the hooks for.
   */
  static updateHooks(shortcut: Shortcut): void {
    this.hooksController.updateHooks(shortcut);
  }

  /**
   * Removes the hooks for a specific shortcut.
   * @param shortcut The shortcut to remove the hooks for.
   */
  static removeHooks(shortcut: Shortcut): void {
    this.hooksController.unregisterAllHooks(shortcut);
  }

  /**
   * Function to run when the plugin dismounts.
   */
  static dismount(): void {
    PyInterop.log("PluginController dismounting...");

    this.shortcutsController.onDismount();
    this.webSocketClient.disconnect();
    this.hooksController.dismount();
    
    PyInterop.log("PluginController dismounted.");
  }
}