import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	WorkspaceLeaf,
	normalizePath,
} from "obsidian";

const DEFAULT_EXTENSIONS = [
	"jpg",
	"jpeg",
	"png",
	"webp",
	"gif",
	"avif",
	"bmp",
	"svg",
	"mp3",
	"wav",
	"opus",
	"aac",
	"m4a",
	"flac",
	"mp4",
	"mkv",
	"mov",
	"avi",
];

const REBUILD_DEBOUNCE_MS = 200;
const HIDDEN_CLASS = "media-sidecar-tools-hidden";

interface MediaSidecarToolsSettings {
	extensions: string[];
	ctrlClickCreatesNote: boolean;
	syncRenames: boolean;
}

const DEFAULT_SETTINGS: MediaSidecarToolsSettings = {
	extensions: [...DEFAULT_EXTENSIONS],
	ctrlClickCreatesNote: true,
	syncRenames: true,
};

interface FileExplorerFileItem {
	el: HTMLElement;
	selfEl: HTMLElement;
}

interface FileExplorerView {
	fileItems: Record<string, FileExplorerFileItem>;
}

function parseExtensionsInput(value: string): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of value.split(/[,\n]/)) {
		const ext = raw.trim().replace(/^\./, "").toLowerCase();
		if (ext && !seen.has(ext)) {
			seen.add(ext);
			result.push(ext);
		}
	}
	return result;
}

function splitPath(path: string): { folder: string; basename: string; extension: string } {
	const slash = path.lastIndexOf("/");
	const folder = slash === -1 ? "" : path.slice(0, slash);
	const name = slash === -1 ? path : path.slice(slash + 1);
	const dot = name.lastIndexOf(".");
	return {
		folder,
		basename: dot === -1 ? name : name.slice(0, dot),
		extension: dot === -1 ? "" : name.slice(dot + 1).toLowerCase(),
	};
}

function joinPath(folder: string, name: string): string {
	return normalizePath(folder ? `${folder}/${name}` : name);
}

export default class MediaSidecarToolsPlugin extends Plugin {
	settings: MediaSidecarToolsSettings = DEFAULT_SETTINGS;
	private rebuildTimer: number | null = null;
	private readonly pendingRenames = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new MediaSidecarToolsSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => this.rebuild());

		this.registerEvent(this.app.vault.on("create", () => this.scheduleRebuild()));
		this.registerEvent(this.app.vault.on("delete", () => this.scheduleRebuild()));
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.scheduleRebuild();
				if (file instanceof TFile) void this.syncPairedRename(file, oldPath);
			})
		);
		this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleRebuild()));

		this.registerDomEvent(activeDocument, "click", this.handleClick, true);
		this.registerEvent(
			this.app.workspace.on("window-open", (_workspaceWindow, win) => {
				this.registerDomEvent(win.document, "click", this.handleClick, true);
			})
		);
	}

	onunload(): void {
		if (this.rebuildTimer !== null) {
			window.clearTimeout(this.rebuildTimer);
			this.rebuildTimer = null;
		}
		this.applyVisibility(new Set());
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<MediaSidecarToolsSettings> | null;
		this.settings = {
			extensions: data?.extensions?.length ? data.extensions : [...DEFAULT_EXTENSIONS],
			ctrlClickCreatesNote: data?.ctrlClickCreatesNote ?? DEFAULT_SETTINGS.ctrlClickCreatesNote,
			syncRenames: data?.syncRenames ?? DEFAULT_SETTINGS.syncRenames,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	rebuild(): void {
		const extensions = new Set(this.settings.extensions);

		const notesByFolder = new Map<string, Set<string>>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const folder = file.parent ? file.parent.path : "";
			let names = notesByFolder.get(folder);
			if (!names) {
				names = new Set();
				notesByFolder.set(folder, names);
			}
			names.add(file.basename);
		}

		const hiddenPaths = new Set<string>();
		for (const file of this.app.vault.getFiles()) {
			if (!(file instanceof TFile)) continue;
			if (!extensions.has(file.extension.toLowerCase())) continue;
			const folder = file.parent ? file.parent.path : "";
			if (notesByFolder.get(folder)?.has(file.basename)) {
				hiddenPaths.add(file.path);
			}
		}

		this.applyVisibility(hiddenPaths);
	}

	private applyVisibility(hiddenPaths: Set<string>): void {
		const leaves: WorkspaceLeaf[] = this.app.workspace.getLeavesOfType("file-explorer");
		for (const leaf of leaves) {
			const view = leaf.view as unknown as FileExplorerView;
			for (const [path, item] of Object.entries(view.fileItems ?? {})) {
				item.selfEl.classList.toggle(HIDDEN_CLASS, hiddenPaths.has(path));
			}
		}
	}

	private scheduleRebuild(): void {
		if (this.rebuildTimer !== null) {
			window.clearTimeout(this.rebuildTimer);
		}
		this.rebuildTimer = window.setTimeout(() => {
			this.rebuildTimer = null;
			this.rebuild();
		}, REBUILD_DEBOUNCE_MS);
	}

	private async syncPairedRename(file: TFile, oldPath: string): Promise<void> {
		if (!this.settings.syncRenames) return;
		if (this.pendingRenames.has(oldPath) || this.pendingRenames.has(file.path)) return;

		const extensions = new Set(this.settings.extensions.map((ext) => ext.toLowerCase()));
		const previous = splitPath(oldPath);
		const currentExtension = file.extension.toLowerCase();

		let partners: TFile[];
		if (previous.extension === "md") {
			if (currentExtension !== "md") return;
			partners = this.pairedMedia(previous.folder, previous.basename, extensions);
		} else if (extensions.has(previous.extension)) {
			if (!extensions.has(currentExtension)) return;
			const note = this.app.vault.getAbstractFileByPath(
				joinPath(previous.folder, `${previous.basename}.md`)
			);
			partners = note instanceof TFile ? [note] : [];
		} else {
			return;
		}

		const folder = file.parent && !file.parent.isRoot() ? file.parent.path : "";
		for (const partner of partners) {
			const target = joinPath(folder, `${file.basename}.${partner.extension}`);
			if (target === partner.path) continue;
			if (this.app.vault.getAbstractFileByPath(target)) {
				new Notice(`Media Sidecar Tools: ${target} already exists`);
				continue;
			}

			this.pendingRenames.add(partner.path);
			this.pendingRenames.add(target);
			try {
				await this.app.fileManager.renameFile(partner, target);
			} catch (error) {
				new Notice(`Media Sidecar Tools: could not rename ${partner.path}`);
				console.error("Media Sidecar Tools: failed to rename paired file", error);
			} finally {
				this.pendingRenames.delete(partner.path);
				this.pendingRenames.delete(target);
			}
		}
	}

	private pairedMedia(folder: string, basename: string, extensions: Set<string>): TFile[] {
		const parent = this.app.vault.getAbstractFileByPath(folder || "/");
		if (!(parent instanceof TFolder)) return [];
		return parent.children.filter(
			(child): child is TFile =>
				child instanceof TFile &&
				child.basename === basename &&
				extensions.has(child.extension.toLowerCase())
		);
	}

	private handleClick = (evt: MouseEvent): void => {
		if (!this.settings.ctrlClickCreatesNote) return;
		if (!(evt.ctrlKey || evt.metaKey)) return;

		const target = evt.target as HTMLElement | null;
		const titleEl = target?.closest(".nav-file-title[data-path]") as HTMLElement | null;
		if (!titleEl) return;

		const path = titleEl.dataset.path;
		if (!path) return;

		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		if (!this.settings.extensions.includes(file.extension.toLowerCase())) return;

		evt.preventDefault();
		evt.stopPropagation();

		void this.createPairedNote(file);
	};

	private async createPairedNote(file: TFile): Promise<void> {
		const folderPath = file.parent && !file.parent.isRoot() ? file.parent.path : "";
		const notePath = normalizePath(
			folderPath ? `${folderPath}/${file.basename}.md` : `${file.basename}.md`
		);

		if (this.app.vault.getAbstractFileByPath(notePath)) return;

		try {
			const link = this.app.fileManager.generateMarkdownLink(file, notePath);
			const embed = link.startsWith("!") ? link : `!${link}`;
			const note = await this.app.vault.create(notePath, `${embed}\n`);
			await this.app.workspace.getLeaf(false).openFile(note);
		} catch (error) {
			new Notice(`Media Sidecar Tools: could not create ${notePath}`);
			console.error("Media Sidecar Tools: failed to create paired note", error);
		}
	}
}

class MediaSidecarToolsSettingTab extends PluginSettingTab {
	plugin: MediaSidecarToolsPlugin;

	constructor(app: App, plugin: MediaSidecarToolsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Create note with Ctrl+Click")
			.setDesc(
				"When enabled, Ctrl+Click (Cmd+Click on macOS) on a file with one of the extensions below creates a Markdown note with the same name in the same folder."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.ctrlClickCreatesNote).onChange(async (value) => {
					this.plugin.settings.ctrlClickCreatesNote = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Keep pairs in sync when renaming")
			.setDesc(
				"When enabled, renaming or moving a media file also renames or moves its note, and renaming or moving a note does the same to the media files paired with it."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncRenames).onChange(async (value) => {
					this.plugin.settings.syncRenames = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("File extensions")
			.setDesc(
				"Attachment file extensions to hide when paired with a note of the same name, separated by commas or new lines."
			)
			.addTextArea((text) => {
				text
					.setPlaceholder(DEFAULT_EXTENSIONS.join(", "))
					.setValue(this.plugin.settings.extensions.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.extensions = parseExtensionsInput(value);
						await this.plugin.saveSettings();
						this.plugin.rebuild();
					});
				text.inputEl.rows = 6;
				text.inputEl.addClass("media-sidecar-tools-extensions-input");
			});
	}
}
