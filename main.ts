import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from "obsidian";

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
const STYLE_EL_ID = "media-sidecar-tools-styles";

interface MediaSidecarToolsSettings {
	extensions: string[];
	ctrlClickCreatesNote: boolean;
}

const DEFAULT_SETTINGS: MediaSidecarToolsSettings = {
	extensions: [...DEFAULT_EXTENSIONS],
	ctrlClickCreatesNote: true,
};

function escapeAttributeValue(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

export default class MediaSidecarToolsPlugin extends Plugin {
	settings: MediaSidecarToolsSettings = DEFAULT_SETTINGS;
	private styleEl: HTMLStyleElement | null = null;
	private rebuildTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.styleEl = document.createElement("style");
		this.styleEl.id = STYLE_EL_ID;
		document.head.appendChild(this.styleEl);

		this.addSettingTab(new MediaSidecarToolsSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => this.rebuild());

		this.registerEvent(this.app.vault.on("create", () => this.scheduleRebuild()));
		this.registerEvent(this.app.vault.on("delete", () => this.scheduleRebuild()));
		this.registerEvent(this.app.vault.on("rename", () => this.scheduleRebuild()));

		this.registerDomEvent(document, "click", this.handleClick, true);
	}

	onunload(): void {
		if (this.rebuildTimer !== null) {
			window.clearTimeout(this.rebuildTimer);
			this.rebuildTimer = null;
		}
		this.styleEl?.remove();
		this.styleEl = null;
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<MediaSidecarToolsSettings> | null;
		this.settings = {
			extensions: data?.extensions?.length ? data.extensions : [...DEFAULT_EXTENSIONS],
			ctrlClickCreatesNote: data?.ctrlClickCreatesNote ?? DEFAULT_SETTINGS.ctrlClickCreatesNote,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	rebuild(): void {
		if (!this.styleEl) return;

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

		const hiddenPaths: string[] = [];
		for (const file of this.app.vault.getFiles()) {
			if (!(file instanceof TFile)) continue;
			if (!extensions.has(file.extension.toLowerCase())) continue;
			const folder = file.parent ? file.parent.path : "";
			if (notesByFolder.get(folder)?.has(file.basename)) {
				hiddenPaths.push(file.path);
			}
		}

		if (hiddenPaths.length === 0) {
			this.styleEl.textContent = "";
			return;
		}

		const selectors = hiddenPaths
			.map((path) => `.nav-file-title[data-path="${escapeAttributeValue(path)}"]`)
			.join(",\n");
		this.styleEl.textContent = `${selectors} {\n\tdisplay: none !important;\n}`;
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
			await this.app.vault.create(notePath, `${embed}\n`);
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
