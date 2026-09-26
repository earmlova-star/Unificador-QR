import { Component, ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

// Hallazgo QA 2026-09-25: ninguna de las vistas cargadas con lazy() (ver
// App.tsx) estaba envuelta en un error boundary — Suspense solo cubre el
// estado "cargando", no un import() que falla. Un supervisor en terreno
// con señal intermitente que toca un ítem del menú justo cuando se corta
// la conexión hacía que el chunk dinámico fallara, React no tenía quién lo
// capturara, y toda la SPA se desmontaba a pantalla blanca sin mensaje ni
// forma de recuperarse salvo recargar — justo en una app pensada
// explícitamente para uso con conexión inestable.
//
// Un error boundary tiene que ser una clase — no existe el equivalente en
// hooks (no hay "useErrorBoundary"), getDerivedStateFromError/
// componentDidCatch solo existen en componentes de clase.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="bg-white rounded-lg border border-red-200 p-8 text-center">
          <p className="text-red-700 font-semibold mb-1">No se pudo cargar esta sección.</p>
          <p className="text-sm text-slate-500 mb-4">
            Puede ser la conexión — revisa la señal e inténtalo de nuevo.
          </p>
          <button
            type="button"
            // Recarga la página en vez de solo limpiar el estado: un
            // import() de React.lazy que ya falló una vez queda con esa
            // promesa rechazada guardada (siempre en el mismo componente
            // lazy()) — reintentar sin recargar volvería a mostrar el
            // mismo error al instante, sin volver a pedir el archivo.
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700"
          >
            Reintentar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
