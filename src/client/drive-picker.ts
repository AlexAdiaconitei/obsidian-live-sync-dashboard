interface PickerResponse {
  action: string;
  docs?: { id?: string; mimeType?: string }[];
}
interface Picker {
  setVisible(visible: boolean): void;
  dispose(): void;
}
interface FolderView {
  setIncludeFolders(value: boolean): FolderView;
  setSelectFolderEnabled(value: boolean): FolderView;
  setOwnedByMe(value: boolean): FolderView;
}
interface PickerBuilder {
  setDeveloperKey(value: string): PickerBuilder;
  setAppId(value: string): PickerBuilder;
  setOAuthToken(value: string): PickerBuilder;
  setOrigin(value: string): PickerBuilder;
  setLocale(value: string): PickerBuilder;
  addView(value: FolderView): PickerBuilder;
  setCallback(value: (data: PickerResponse) => void): PickerBuilder;
  build(): Picker;
}
interface PickerApi {
  DocsView: new (view: string) => FolderView;
  ViewId: { FOLDERS: string };
  PickerBuilder: new () => PickerBuilder;
}
const globals = window as Window & {
  gapi?: {
    load(
      module: string,
      options: { callback(): void; onerror(): void; timeout: number; ontimeout(): void },
    ): void;
  };
  google?: { picker: PickerApi };
};

let loading: Promise<PickerApi> | undefined;
function loadPicker(): Promise<PickerApi> {
  if (globals.google?.picker) return Promise.resolve(globals.google.picker);
  if (loading) return loading;
  loading = new Promise<PickerApi>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = setTimeout(() => fail(), 20_000);
    const fail = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error("picker_unavailable"));
    };
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onerror = fail;
    script.onload = () => {
      if (!globals.gapi) return fail();
      globals.gapi.load("picker", {
        callback: () => {
          clearTimeout(timeout);
          if (!globals.google?.picker) return fail();
          resolve(globals.google.picker);
        },
        onerror: fail,
        timeout: 15_000,
        ontimeout: fail,
      });
    };
    document.head.append(script);
  }).catch((error) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

const root = document.querySelector<HTMLElement>("#drive-folder-picker");
const open = document.querySelector<HTMLButtonElement>("#drive-picker-open");
const status = document.querySelector<HTMLElement>("#drive-picker-status");
const form = document.querySelector<HTMLFormElement>("#drive-folder-selection");
if (root && open && status && form) {
  let submitted = false;
  open.addEventListener("click", async () => {
    open.disabled = true;
    status.textContent = root.dataset.loading ?? "";
    try {
      const csrf = form.querySelector<HTMLInputElement>('[name="csrf"]')!.value;
      const [api, response] = await Promise.all([
        loadPicker(),
        fetch("/backups/google/picker-session", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ csrf }),
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        }),
      ]);
      if (!response.ok) throw new Error("picker_unavailable");
      const session = (await response.json()) as {
        accessToken?: string;
        apiKey?: string;
        appId?: string;
      };
      if (!session.accessToken || !session.apiKey || !session.appId)
        throw new Error("picker_unavailable");
      const view = new api.DocsView(api.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setOwnedByMe(true);
      const picker = new api.PickerBuilder()
        .setDeveloperKey(session.apiKey)
        .setAppId(session.appId)
        .setOAuthToken(session.accessToken)
        .setOrigin(location.origin)
        .setLocale(document.documentElement.lang)
        .addView(view)
        .setCallback((data) => {
          if (submitted) return;
          if (data.action === "cancel") {
            picker.dispose();
            open.disabled = false;
            status.textContent = root.dataset.cancelled ?? "";
          } else if (data.action === "picked") {
            const selected = data.docs?.[0];
            if (
              data.docs?.length !== 1 ||
              !selected?.id ||
              !/^[\w-]{1,256}$/.test(selected.id) ||
              selected.mimeType !== "application/vnd.google-apps.folder"
            ) {
              status.textContent = root.dataset.failed ?? "";
              open.disabled = false;
              picker.dispose();
              return;
            }
            submitted = true;
            form.querySelector<HTMLInputElement>('[name="folderId"]')!.value = selected.id;
            picker.dispose();
            form.requestSubmit();
          }
        })
        .build();
      status.textContent = "";
      picker.setVisible(true);
    } catch {
      status.textContent = root.dataset.failed ?? "";
      open.disabled = false;
    }
  });
}
