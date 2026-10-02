{ pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm.enable = true;
  };

  packages = [ pkgs.git ];

  enterTest = ''
    node -e 'if (process.versions.node.split(".")[0] !== "24") process.exit(1)'
    pnpm install --frozen-lockfile
    pnpm check
  '';
}
