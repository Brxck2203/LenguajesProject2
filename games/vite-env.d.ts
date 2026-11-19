interface ImportMetaEnv {
  readonly VITE_GO_URL?: string;
  readonly VITE_SCALA_URL?: string;
  readonly VITE_PROLOG_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  GAMECONSOLE_CONFIG?: {
    goUrl?: string;
    scalaUrl?: string;
    prologUrl?: string;
  };
}
