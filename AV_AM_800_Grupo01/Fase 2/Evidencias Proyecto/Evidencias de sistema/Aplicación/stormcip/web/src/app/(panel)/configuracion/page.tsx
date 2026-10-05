import GuardRol from "@/components/layout/GuardRol";

export const metadata = { title: "Configuración · StormCIP" };

export default function ConfiguracionPage() {
  return (
    <GuardRol roles={["admin"]}>
      <div className="shell-page-title">
        <h1>Configuración</h1>
      </div>
      <div className="shell-placeholder">Contenido pendiente.</div>
    </GuardRol>
  );
}
