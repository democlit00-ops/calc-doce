"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface Admin {
  id: string
  usuario: string
  senha: string
  permissoes: {
    configurarPesos: boolean
    gerenciarAdmins: boolean
    registrarVendas: boolean
    gerenteVendas: boolean
  }
  criadoEm: string
}

interface AdminLogado {
  id: string
  usuario: string
  permissoes: {
    configurarPesos: boolean
    gerenciarAdmins: boolean
    registrarVendas: boolean
    gerenteVendas: boolean
  }
}

interface Venda {
  id: string
  quantidade: number
  valorTotal: number
  dataHora: string
  usuario: string
}

export default function CalculadoraDoces() {
  const [paginaAtual, setPaginaAtual] = useState<"config" | "calculo" | "gerenciarAdmins" | "vendas" | "relatorios">(
    "calculo",
  )

  const [unidades, setUnidades] = useState<number>(100)
  const [mensagemSalvo, setMensagemSalvo] = useState<string>("")
  const [adminLogado, setAdminLogado] = useState<AdminLogado | null>(null)
  const [showLogin, setShowLogin] = useState<boolean>(false)
  const [loginData, setLoginData] = useState({ usuario: "", senha: "" })
  const [loginError, setLoginError] = useState<string>("")
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false)

  const [admins, setAdmins] = useState<Admin[]>([])
  const [novoAdmin, setNovoAdmin] = useState({
    usuario: "",
    senha: "",
    permissoes: {
      configurarPesos: false,
      gerenciarAdmins: false,
      registrarVendas: false,
      gerenteVendas: false,
    },
  })
  const [editandoAdmin, setEditandoAdmin] = useState<string | null>(null)
  const [mensagemAdmin, setMensagemAdmin] = useState<string>("")

  const [vendas, setVendas] = useState<Venda[]>([])
  const [novaVenda, setNovaVenda] = useState({
    quantidade: 0,
    valorTotal: 0,
  })
  const [mensagemVenda, setMensagemVenda] = useState<string>("")

  const [pesosEditaveis, setPesosEditaveis] = useState({
    poAluminio: 3.0,
    efedrina: 4.0,
    folhaPapel: 15.0,
    embalagemPlastica: 3.0,
  })

  const [showAlterarSenha, setShowAlterarSenha] = useState<boolean>(false)
  const [alterarSenhaData, setAlterarSenhaData] = useState({
    senhaAtual: "",
    novaSenha: "",
    confirmarSenha: "",
  })
  const [alterarSenhaError, setAlterarSenhaError] = useState<string>("")
  const [showAlterarSenhaAdmin, setShowAlterarSenhaAdmin] = useState<string | null>(null)
  const [novaSenhaAdmin, setNovaSenhaAdmin] = useState<string>("")

  const [adminParaAlterarSenha, setAdminParaAlterarSenha] = useState<string | null>(null)
  const [showAdminChangePassword, setShowAdminChangePassword] = useState<boolean>(false)

  useEffect(() => {
    const savedPesos = localStorage.getItem("pesosIngredientes")
    if (savedPesos) {
      setPesosEditaveis(JSON.parse(savedPesos))
    }

    const savedAdmins = localStorage.getItem("admins")
    if (savedAdmins) {
      setAdmins(JSON.parse(savedAdmins))
    } else {
      const adminPadrao: Admin = {
        id: "1",
        usuario: "admin",
        senha: "123456",
        permissoes: {
          configurarPesos: true,
          gerenciarAdmins: true,
          registrarVendas: true,
          gerenteVendas: false,
        },
        criadoEm: new Date().toISOString(),
      }
      setAdmins([adminPadrao])
      localStorage.setItem("admins", JSON.stringify([adminPadrao]))
    }

    const savedVendas = localStorage.getItem("vendas")
    if (savedVendas) {
      setVendas(JSON.parse(savedVendas))
    }
  }, [])

  const handleLogin = () => {
    const adminEncontrado = admins.find(
      (admin) => admin.usuario === loginData.usuario && admin.senha === loginData.senha,
    )

    if (adminEncontrado) {
      const adminLogadoData: AdminLogado = {
        id: adminEncontrado.id,
        usuario: adminEncontrado.usuario,
        permissoes: adminEncontrado.permissoes,
      }
      setAdminLogado(adminLogadoData)
      setShowLogin(false)
      setLoginError("")
      localStorage.setItem("adminLogadoAtual", JSON.stringify(adminLogadoData))
    } else {
      setLoginError("Usuário ou senha incorretos!")
    }
  }

  const handleLogout = () => {
    setAdminLogado(null)
    localStorage.removeItem("adminLogadoAtual")
    setPaginaAtual("calculo")
  }

  const tentarAcessarConfig = () => {
    if (!adminLogado) {
      setShowLogin(true)
    } else if (!adminLogado.permissoes.configurarPesos) {
      setMensagemAdmin("Você não tem permissão para configurar pesos!")
      setTimeout(() => setMensagemAdmin(""), 3000)
    } else {
      setPaginaAtual("config")
    }
  }

  const tentarAcessarGerenciarAdmins = () => {
    if (!adminLogado) {
      setShowLogin(true)
    } else if (!adminLogado.permissoes.gerenciarAdmins) {
      setMensagemAdmin("Você não tem permissão para gerenciar administradores!")
      setTimeout(() => setMensagemAdmin(""), 3000)
    } else {
      setPaginaAtual("gerenciarAdmins")
    }
  }

  const tentarAcessarVendas = () => {
    if (!adminLogado) {
      setShowLogin(true)
    } else if (!adminLogado.permissoes.registrarVendas) {
      setMensagemAdmin("Você não tem permissão para registrar vendas!")
      setTimeout(() => setMensagemAdmin(""), 3000)
    } else {
      setPaginaAtual("vendas")
    }
  }

  const tentarAcessarRelatorios = () => {
    if (!adminLogado) {
      setShowLogin(true)
    } else if (!adminLogado.permissoes.registrarVendas && !adminLogado.permissoes.gerenteVendas) {
      setMensagemAdmin("Você não tem permissão para ver relatórios de vendas!")
      setTimeout(() => setMensagemAdmin(""), 3000)
    } else {
      setPaginaAtual("relatorios")
    }
  }

  const criarAdmin = () => {
    if (!novoAdmin.usuario || !novoAdmin.senha) {
      setMensagemAdmin("Preencha todos os campos!")
      setTimeout(() => setMensagemAdmin(""), 3000)
      return
    }

    const adminExiste = admins.find((admin) => admin.usuario === novoAdmin.usuario)
    if (adminExiste) {
      setMensagemAdmin("Usuário já existe!")
      setTimeout(() => setMensagemAdmin(""), 3000)
      return
    }

    const novoAdminCompleto: Admin = {
      ...novoAdmin,
      id: Date.now().toString(),
      criadoEm: new Date().toLocaleString("pt-BR"),
    }

    const novosAdmins = [...admins, novoAdminCompleto]
    setAdmins(novosAdmins)
    localStorage.setItem("adminsDoSistema", JSON.stringify(novosAdmins))

    setNovoAdmin({
      usuario: "",
      senha: "",
      permissoes: {
        configurarPesos: false,
        gerenciarAdmins: false,
        registrarVendas: false,
        gerenteVendas: false,
      },
    })

    setMensagemAdmin("Administrador criado com sucesso!")
    setTimeout(() => setMensagemAdmin(""), 3000)
  }

  const excluirAdmin = (id: string) => {
    if (admins.length === 1) {
      setMensagemAdmin("Não é possível excluir o último administrador!")
      setTimeout(() => setMensagemAdmin(""), 3000)
      return
    }

    const novosAdmins = admins.filter((admin) => admin.id !== id)
    setAdmins(novosAdmins)
    localStorage.setItem("adminsDoSistema", JSON.stringify(novosAdmins))

    setMensagemAdmin("Administrador excluído com sucesso!")
    setTimeout(() => setMensagemAdmin(""), 3000)
  }

  const atualizarPermissaoAdmin = (id: string, permissao: keyof Admin["permissoes"], valor: boolean) => {
    const novosAdmins = admins.map((admin) => {
      if (admin.id === id) {
        return {
          ...admin,
          permissoes: {
            ...admin.permissoes,
            [permissao]: valor,
          },
        }
      }
      return admin
    })

    setAdmins(novosAdmins)
    localStorage.setItem("adminsDoSistema", JSON.stringify(novosAdmins))
  }

  const alterarPropraSenha = () => {
    if (!alterarSenhaData.senhaAtual || !alterarSenhaData.novaSenha || !alterarSenhaData.confirmarSenha) {
      setAlterarSenhaError("Preencha todos os campos!")
      setTimeout(() => setAlterarSenhaError(""), 3000)
      return
    }

    if (alterarSenhaData.novaSenha !== alterarSenhaData.confirmarSenha) {
      setAlterarSenhaError("Nova senha e confirmação não coincidem!")
      setTimeout(() => setAlterarSenhaError(""), 3000)
      return
    }

    const adminAtual = admins.find((admin) => admin.id === adminLogado?.id)
    if (!adminAtual || adminAtual.senha !== alterarSenhaData.senhaAtual) {
      setAlterarSenhaError("Senha atual incorreta!")
      setTimeout(() => setAlterarSenhaError(""), 3000)
      return
    }

    const novosAdmins = admins.map((admin) => {
      if (admin.id === adminLogado?.id) {
        return { ...admin, senha: alterarSenhaData.novaSenha }
      }
      return admin
    })

    setAdmins(novosAdmins)
    localStorage.setItem("adminsDoSistema", JSON.stringify(novosAdmins))

    setShowAlterarSenha(false)
    setAlterarSenhaData({ senhaAtual: "", novaSenha: "", confirmarSenha: "" })
    setMensagemAdmin("Senha alterada com sucesso!")
    setTimeout(() => setMensagemAdmin(""), 3000)
  }

  const alterarSenhaOutroAdmin = (adminId: string) => {
    if (!novaSenhaAdmin) {
      setMensagemAdmin("Digite a nova senha!")
      setTimeout(() => setMensagemAdmin(""), 3000)
      return
    }

    const novosAdmins = admins.map((admin) => {
      if (admin.id === adminId) {
        return { ...admin, senha: novaSenhaAdmin }
      }
      return admin
    })

    setAdmins(novosAdmins)
    localStorage.setItem("adminsDoSistema", JSON.stringify(novosAdmins))

    setShowAlterarSenhaAdmin(null)
    setNovaSenhaAdmin("")
    setMensagemAdmin("Senha do administrador alterada com sucesso!")
    setTimeout(() => setMensagemAdmin(""), 3000)
  }

  const registrarVenda = () => {
    if (novaVenda.quantidade <= 0 || novaVenda.valorTotal <= 0) {
      setMensagemVenda("Por favor, preencha quantidade e valor válidos")
      setTimeout(() => setMensagemVenda(""), 3000)
      return
    }

    const venda: Venda = {
      id: Date.now().toString(),
      quantidade: novaVenda.quantidade,
      valorTotal: novaVenda.valorTotal,
      dataHora: new Date().toLocaleString("pt-BR"),
      usuario: adminLogado?.usuario || "Usuário",
    }

    const novasVendas = [...vendas, venda]
    setVendas(novasVendas)
    localStorage.setItem("vendas", JSON.stringify(novasVendas))

    setNovaVenda({ quantidade: 0, valorTotal: 0 })
    setMensagemVenda("Venda registrada com sucesso!")
    setTimeout(() => setMensagemVenda(""), 3000)
  }

  const calcularTotalVendas = () => {
    return vendas.reduce((total, venda) => total + venda.valorTotal, 0)
  }

  const calcularQuantidadeTotal = () => {
    return vendas.reduce((total, venda) => total + venda.quantidade, 0)
  }

  const obterVendasFiltradas = () => {
    if (!adminLogado) return []

    // Se é gerente de vendas, pode ver todas as vendas
    if (adminLogado.permissoes.gerenteVendas) {
      return vendas
    }

    // Se é apenas vendedor, só pode ver suas próprias vendas
    if (adminLogado.permissoes.registrarVendas) {
      return vendas.filter((venda) => venda.usuario === adminLogado.usuario)
    }

    return []
  }

  const calcularEstatisticasFiltradas = () => {
    const vendasFiltradas = obterVendasFiltradas()
    const totalVendas = vendasFiltradas.reduce((acc, venda) => acc + venda.valorTotal, 0)
    const quantidadeTotal = vendasFiltradas.reduce((acc, venda) => acc + venda.quantidade, 0)

    return {
      totalVendas: vendasFiltradas.length,
      quantidadeTotal,
      valorTotal: totalVendas,
    }
  }

  // ... existing code for other functions ...

  const ingredientesBase = {
    poAluminio: { quantidade: 20, pesoUnitario: pesosEditaveis.poAluminio },
    efedrina: { quantidade: 40, pesoUnitario: pesosEditaveis.efedrina },
    folhaPapel: { quantidade: 50, pesoUnitario: pesosEditaveis.folhaPapel },
    embalagemPlastica: { quantidade: 20, pesoUnitario: pesosEditaveis.embalagemPlastica },
    dinheiro: 3000,
  }

  const multiplicador = unidades / 100

  const atualizarPeso = (ingrediente: keyof typeof pesosEditaveis, novoPeso: number) => {
    setPesosEditaveis((prev) => ({
      ...prev,
      [ingrediente]: novoPeso,
    }))
  }

  const calcularIngredientes = () => {
    return {
      poAluminio: {
        quantidade: ingredientesBase.poAluminio.quantidade * multiplicador,
        pesoTotal: ingredientesBase.poAluminio.quantidade * ingredientesBase.poAluminio.pesoUnitario * multiplicador,
      },
      efedrina: {
        quantidade: ingredientesBase.efedrina.quantidade * multiplicador,
        pesoTotal: ingredientesBase.efedrina.quantidade * ingredientesBase.efedrina.pesoUnitario * multiplicador,
      },
      folhaPapel: {
        quantidade: ingredientesBase.folhaPapel.quantidade * multiplicador,
        pesoTotal: ingredientesBase.folhaPapel.quantidade * ingredientesBase.folhaPapel.pesoUnitario * multiplicador,
      },
      embalagemPlastica: {
        quantidade: ingredientesBase.embalagemPlastica.quantidade * multiplicador,
        pesoTotal:
          ingredientesBase.embalagemPlastica.quantidade *
          ingredientesBase.embalagemPlastica.pesoUnitario *
          multiplicador,
      },
      dinheiro: ingredientesBase.dinheiro * multiplicador,
    }
  }

  const ingredientes = calcularIngredientes()

  const pesoTotal =
    ingredientes.poAluminio.pesoTotal +
    ingredientes.efedrina.pesoTotal +
    ingredientes.folhaPapel.pesoTotal +
    ingredientes.embalagemPlastica.pesoTotal

  const pesoTotalDoces = unidades * 0.15

  const handleUnidadesChange = (valor: string) => {
    const num = Number.parseInt(valor) || 0
    const multiplo = Math.round(num / 100) * 100
    setUnidades(Math.max(100, multiplo))
  }

  const incrementar = () => {
    setUnidades((prev) => prev + 100)
  }

  const decrementar = () => {
    setUnidades((prev) => Math.max(100, prev - 100))
  }

  const salvarPesos = () => {
    localStorage.setItem("pesosIngredientes", JSON.stringify(pesosEditaveis))
    setMensagemSalvo("Pesos salvos com sucesso!")
    setTimeout(() => setMensagemSalvo(""), 3000)
  }

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  const logout = () => {
    setAdminLogado(null)
    localStorage.removeItem("adminLogadoAtual")
    setPaginaAtual("calculo")
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 relative overflow-hidden">
      {/* Elementos decorativos de fundo */}
      <div className="absolute inset-0 pointer-events-none">
        <img
          src="/colorful-candy-wrapper-package-red.jpg"
          alt=""
          className="absolute top-10 left-10 w-15 h-20 opacity-20 rotate-12 animate-pulse"
        />
        <img
          src="/blue-candy-package-wrapper-sweet.jpg"
          alt=""
          className="absolute top-32 right-20 w-12 h-18 opacity-15 -rotate-45"
        />
        <img
          src="/green-gummy-bears-package-wrapper.jpg"
          alt=""
          className="absolute top-64 left-32 w-18 h-22 opacity-25 rotate-6"
        />
        <img
          src="/yellow-lollipop-candy-wrapper-package.jpg"
          alt=""
          className="absolute bottom-40 right-16 w-16 h-21 opacity-20 -rotate-12"
        />
        <img
          src="/purple-chocolate-candy-bar-wrapper.jpg"
          alt=""
          className="absolute bottom-20 left-20 w-14 h-19 opacity-15 rotate-30"
        />
        <img
          src="/orange-gummy-candy-package-colorful.jpg"
          alt=""
          className="absolute top-20 right-40 w-15 h-20 opacity-20 -rotate-6"
        />
        <img
          src="/pink-bubblegum-candy-wrapper-sweet.jpg"
          alt=""
          className="absolute bottom-60 right-32 w-12 h-18 opacity-25 rotate-45"
        />
        <img
          src="/multicolor-candy-mix-package-wrapper.jpg"
          alt=""
          className="absolute top-48 left-16 w-16 h-21 opacity-15 -rotate-20"
        />
      </div>

      <button
        onClick={toggleSidebar}
        className="fixed top-4 left-4 z-50 p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50 transition-colors"
      >
        <div className="w-6 h-6 flex flex-col justify-center space-y-1">
          <div className="w-full h-0.5 bg-gray-600"></div>
          <div className="w-full h-0.5 bg-gray-600"></div>
          <div className="w-full h-0.5 bg-gray-600"></div>
        </div>
      </button>

      {/* Sidebar */}
      <div
        className={`fixed top-0 left-0 h-full w-80 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-40 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-6 h-full overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-800">🍬 Menu</h2>
            <button onClick={toggleSidebar} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              ✕
            </button>
          </div>

          {/* Status do Admin */}
          <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-200">
            {adminLogado ? (
              <div className="space-y-2">
                <div className="text-sm font-medium text-green-700">👤 Logado como:</div>
                <div className="font-semibold text-gray-800">{adminLogado.usuario}</div>
                <div className="flex gap-2 mt-3">
                  <Button onClick={() => setShowAlterarSenha(true)} size="sm" variant="outline" className="text-xs">
                    🔑 Alterar Senha
                  </Button>
                  <Button onClick={logout} size="sm" variant="outline" className="text-xs text-red-600 bg-transparent">
                    🚪 Sair
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-sm text-gray-600 mb-2">Não logado</div>
                <Button onClick={() => setShowLogin(true)} size="sm" className="w-full">
                  🔐 Fazer Login
                </Button>
              </div>
            )}
          </div>

          {/* Navegação */}
          <div className="space-y-3">
            <Button
              onClick={() => {
                setPaginaAtual("calculo")
                setSidebarOpen(false)
              }}
              variant={paginaAtual === "calculo" ? "default" : "outline"}
              className="w-full justify-start"
            >
              🧮 Lista de Ingredientes
            </Button>

            <Button
              onClick={() => {
                tentarAcessarVendas()
                setSidebarOpen(false)
              }}
              variant={paginaAtual === "vendas" ? "default" : "outline"}
              className="w-full justify-start"
            >
              💰 Registrar Vendas
            </Button>

            <Button
              onClick={tentarAcessarRelatorios}
              variant="outline"
              className="w-full justify-start text-left bg-transparent"
            >
              📊 Relatórios de Vendas
            </Button>

            {adminLogado && adminLogado.permissoes.configurarPesos && (
              <Button
                onClick={() => {
                  setPaginaAtual("config")
                  setSidebarOpen(false)
                }}
                variant={paginaAtual === "config" ? "default" : "outline"}
                className="w-full justify-start"
              >
                ⚙️ Configurar Pesos
              </Button>
            )}

            {adminLogado && adminLogado.permissoes.gerenciarAdmins && (
              <Button
                onClick={() => {
                  setPaginaAtual("gerenciarAdmins")
                  setSidebarOpen(false)
                }}
                variant={paginaAtual === "gerenciarAdmins" ? "default" : "outline"}
                className="w-full justify-start"
              >
                👥 Gerenciar Admins
              </Button>
            )}
          </div>

          {/* Resumo Rápido */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-semibold text-sm text-gray-700 mb-2">📋 Resumo Rápido</h3>
            <div className="text-xs space-y-1 text-gray-600">
              <div>Unidades: {unidades}</div>
              <div>Custo: R$ {(ingredientesBase.dinheiro * (unidades / 100)).toLocaleString()}</div>
              <div>Peso: {(pesoTotal + unidades * 0.15).toFixed(1)} kg</div>
              <div className="border-t pt-2 mt-2">
                <div>Total Vendas: R$ {calcularTotalVendas().toLocaleString()}</div>
                <div>Qtd Vendida: {calcularQuantidadeTotal()}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAlterarSenha && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle className="text-center">🔑 Alterar Minha Senha</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Senha Atual</label>
                <input
                  type="password"
                  value={alterarSenhaData.senhaAtual}
                  onChange={(e) => setAlterarSenhaData((prev) => ({ ...prev, senhaAtual: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="Digite sua senha atual"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Nova Senha</label>
                <input
                  type="password"
                  value={alterarSenhaData.novaSenha}
                  onChange={(e) => setAlterarSenhaData((prev) => ({ ...prev, novaSenha: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="Digite a nova senha"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Confirmar Nova Senha</label>
                <input
                  type="password"
                  value={alterarSenhaData.confirmarSenha}
                  onChange={(e) => setAlterarSenhaData((prev) => ({ ...prev, confirmarSenha: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="Confirme a nova senha"
                />
              </div>
              {alterarSenhaError && (
                <div className="text-red-600 text-sm bg-red-50 p-2 rounded border border-red-200">
                  ❌ {alterarSenhaError}
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={alterarPropraSenha} className="flex-1">
                  Alterar Senha
                </Button>
                <Button onClick={() => setShowAlterarSenha(false)} variant="outline" className="flex-1">
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {showAdminChangePassword && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle className="text-center">🔑 Alterar Senha de Administrador</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nova Senha</label>
                <input
                  type="password"
                  value={novaSenhaAdmin}
                  onChange={(e) => setNovaSenhaAdmin(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="Digite a nova senha"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => alterarSenhaOutroAdmin(adminParaAlterarSenha || "")} className="flex-1">
                  Alterar Senha
                </Button>
                <Button onClick={() => setShowAdminChangePassword(false)} variant="outline" className="flex-1">
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {sidebarOpen && <div className="fixed inset-0 bg-black bg-opacity-30 z-30" onClick={toggleSidebar}></div>}

      {/* Conteúdo Principal */}
      <div className="flex-1 p-6">
        {paginaAtual === "calculo" && (
          <Card className="backdrop-blur-sm bg-white/90">
            <CardHeader>
              <CardTitle className="text-green-700">🧪 Ingredientes Necessários</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  {
                    nome: "Pó de alumínio",
                    quantidade: 20 * multiplicador,
                    peso: pesosEditaveis.poAluminio,
                    imagem: "/aluminum-powder-icon.png",
                  },
                  {
                    nome: "Efedrina",
                    quantidade: 40 * multiplicador,
                    peso: pesosEditaveis.efedrina,
                    imagem:
                      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-1QOSAugpdletWvC2aXrsSqtsTRcPo3.png",
                  },
                  {
                    nome: "Folha de papel",
                    quantidade: 50 * multiplicador,
                    peso: pesosEditaveis.folhaPapel,
                    imagem:
                      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-izeyae8nGFsFtsFKZv1OxhhYgs8D2I.png",
                  },
                  {
                    nome: "Embalagem plástica",
                    quantidade: 20 * multiplicador,
                    peso: pesosEditaveis.embalagemPlastica,
                    imagem:
                      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-kHPJaDZc6EVJluSQT0uTFlc32MKkf5.png",
                  },
                ].map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{item.nome}</span>
                      <img
                        src={item.imagem || "/placeholder.svg"}
                        alt={item.nome}
                        className="w-10 h-10 object-contain rounded"
                      />
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{item.quantidade} unidades</div>
                      <div className="text-sm text-gray-600">
                        Peso total: {(item.quantidade * item.peso).toFixed(1)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Controles de Quantidade */}
              <div className="mt-6 flex items-center justify-center gap-4">
                <Button onClick={() => setUnidades(Math.max(100, unidades - 100))} variant="outline" size="lg">
                  -100
                </Button>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-700">{unidades}</div>
                  <div className="text-sm text-gray-600">unidades</div>
                </div>
                <Button onClick={() => setUnidades(unidades + 100)} variant="outline" size="lg">
                  +100
                </Button>
              </div>

              {/* Resumo Total */}
              <div className="mt-6 p-4 bg-green-50 rounded-lg">
                <h3 className="font-semibold text-green-800 mb-2">📊 Resumo Total</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Peso dos ingredientes:</span>
                    <div className="font-semibold">
                      {(
                        ingredientes.poAluminio.pesoTotal +
                        ingredientes.efedrina.pesoTotal +
                        ingredientes.folhaPapel.pesoTotal +
                        ingredientes.embalagemPlastica.pesoTotal
                      ).toFixed(1)}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600">Peso dos doces:</span>
                    <div className="font-semibold">{pesoTotalDoces.toFixed(1)} kg</div>
                  </div>
                  <div>
                    <span className="text-gray-600">Custo total:</span>
                    <div className="font-semibold">R$ {ingredientes.dinheiro.toLocaleString()}</div>
                  </div>
                  <div>
                    <span className="text-gray-600">Unidades produzidas:</span>
                    <div className="font-semibold">{unidades}</div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-green-200">
                    <h4 className="font-semibold text-green-800 mb-2">💰 Análise de Custo</h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Custo por doce:</span>
                        <div className="font-semibold">R$ {(ingredientes.dinheiro / unidades).toFixed(2)}</div>
                      </div>
                      <div>
                        <span className="text-gray-600">Peso por doce:</span>
                        <div className="font-semibold">0.15</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {paginaAtual === "config" && adminLogado && adminLogado.permissoes.configurarPesos && (
          <Card className="backdrop-blur-sm bg-white/90">
            <CardHeader>
              <CardTitle className="text-blue-700">⚙️ Configurar Pesos dos Ingredientes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium mb-2">Peso do Pó de alumínio (por unidade)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={pesosEditaveis.poAluminio}
                      onChange={(e) =>
                        setPesosEditaveis({ ...pesosEditaveis, poAluminio: Number.parseFloat(e.target.value) || 0 })
                      }
                      className="w-full p-2 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Peso da Efedrina (por unidade)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={pesosEditaveis.efedrina}
                      onChange={(e) =>
                        setPesosEditaveis({ ...pesosEditaveis, efedrina: Number.parseFloat(e.target.value) || 0 })
                      }
                      className="w-full p-2 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Peso da Folha de papel (por unidade)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={pesosEditaveis.folhaPapel}
                      onChange={(e) =>
                        setPesosEditaveis({ ...pesosEditaveis, folhaPapel: Number.parseFloat(e.target.value) || 0 })
                      }
                      className="w-full p-2 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Peso da Embalagem plástica (por unidade)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={pesosEditaveis.embalagemPlastica}
                      onChange={(e) =>
                        setPesosEditaveis({
                          ...pesosEditaveis,
                          embalagemPlastica: Number.parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full p-2 border rounded-lg"
                    />
                  </div>
                </div>

                <div className="flex gap-4">
                  <Button onClick={salvarPesos} className="bg-green-600 hover:bg-green-700">
                    💾 Salvar Configurações
                  </Button>
                  {adminLogado && (
                    <Button onClick={() => setShowAlterarSenha(true)} variant="outline">
                      🔑 Alterar Minha Senha
                    </Button>
                  )}
                </div>

                {mensagemSalvo && <div className="p-3 bg-green-100 text-green-800 rounded-lg">{mensagemSalvo}</div>}
              </div>
            </CardContent>
          </Card>
        )}

        {paginaAtual === "gerenciarAdmins" && adminLogado && adminLogado.permissoes.gerenciarAdmins && (
          <Card className="backdrop-blur-sm bg-white/90">
            <CardHeader>
              <CardTitle className="text-purple-700">👥 Gerenciar Administradores</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Criar Novo Admin */}
                <div className="p-4 border rounded-lg bg-gray-50">
                  <h3 className="font-semibold mb-4">➕ Criar Novo Administrador</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Usuário</label>
                      <input
                        type="text"
                        value={novoAdmin.usuario}
                        onChange={(e) => setNovoAdmin({ ...novoAdmin, usuario: e.target.value })}
                        className="w-full p-2 border rounded-lg"
                        placeholder="Nome do usuário"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Senha</label>
                      <input
                        type="password"
                        value={novoAdmin.senha}
                        onChange={(e) => setNovoAdmin({ ...novoAdmin, senha: e.target.value })}
                        className="w-full p-2 border rounded-lg"
                        placeholder="Senha do usuário"
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="block text-sm font-medium mb-2">Permissões</label>
                    <div className="space-y-2">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={novoAdmin.permissoes.configurarPesos}
                          onChange={(e) =>
                            setNovoAdmin({
                              ...novoAdmin,
                              permissoes: { ...novoAdmin.permissoes, configurarPesos: e.target.checked },
                            })
                          }
                          className="mr-2"
                        />
                        Configurar Pesos dos Ingredientes
                      </label>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={novoAdmin.permissoes.gerenciarAdmins}
                          onChange={(e) =>
                            setNovoAdmin({
                              ...novoAdmin,
                              permissoes: { ...novoAdmin.permissoes, gerenciarAdmins: e.target.checked },
                            })
                          }
                          className="mr-2"
                        />
                        Gerenciar Administradores
                      </label>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={novoAdmin.permissoes.registrarVendas}
                          onChange={(e) =>
                            setNovoAdmin({
                              ...novoAdmin,
                              permissoes: { ...novoAdmin.permissoes, registrarVendas: e.target.checked },
                            })
                          }
                          className="mr-2"
                        />
                        Registrar Vendas
                      </label>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={novoAdmin.permissoes.gerenteVendas}
                          onChange={(e) =>
                            setNovoAdmin({
                              ...novoAdmin,
                              permissoes: { ...novoAdmin.permissoes, gerenteVendas: e.target.checked },
                            })
                          }
                          className="mr-2"
                        />
                        Gerente de Vendas
                      </label>
                    </div>
                  </div>

                  <Button onClick={criarAdmin} className="mt-4 bg-blue-600 hover:bg-blue-700">
                    ➕ Criar Administrador
                  </Button>
                </div>

                {/* Lista de Admins Existentes */}
                <div>
                  <h3 className="font-semibold mb-4">📋 Administradores Existentes</h3>
                  <div className="space-y-3">
                    {admins.map((admin) => (
                      <div key={admin.usuario} className="p-4 border rounded-lg bg-white">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-semibold">{admin.usuario}</div>
                            <div className="text-sm text-gray-600 mt-2">
                              <div className="font-medium mb-1">Permissões:</div>
                              <div className="space-y-1">
                                <label className="flex items-center">
                                  <input
                                    type="checkbox"
                                    checked={admin.permissoes.configurarPesos}
                                    onChange={(e) =>
                                      atualizarPermissaoAdmin(admin.usuario, "configurarPesos", e.target.checked)
                                    }
                                    className="mr-2"
                                  />
                                  <span className="text-sm">Configurar Pesos</span>
                                </label>
                                <label className="flex items-center">
                                  <input
                                    type="checkbox"
                                    checked={admin.permissoes.gerenciarAdmins}
                                    onChange={(e) =>
                                      atualizarPermissaoAdmin(admin.usuario, "gerenciarAdmins", e.target.checked)
                                    }
                                    className="mr-2"
                                  />
                                  <span className="text-sm">Gerenciar Admins</span>
                                </label>
                                <label className="flex items-center">
                                  <input
                                    type="checkbox"
                                    checked={admin.permissoes.registrarVendas}
                                    onChange={(e) =>
                                      atualizarPermissaoAdmin(admin.usuario, "registrarVendas", e.target.checked)
                                    }
                                    className="mr-2"
                                  />
                                  <span className="text-sm">Registrar Vendas</span>
                                </label>
                                <label className="flex items-center">
                                  <input
                                    type="checkbox"
                                    checked={admin.permissoes.gerenteVendas}
                                    onChange={(e) =>
                                      atualizarPermissaoAdmin(admin.usuario, "gerenteVendas", e.target.checked)
                                    }
                                    className="mr-2"
                                  />
                                  <span className="text-sm">Gerente de Vendas</span>
                                </label>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => {
                                setAdminParaAlterarSenha(admin.usuario)
                                setShowAdminChangePassword(true)
                              }}
                              variant="outline"
                              size="sm"
                            >
                              🔑 Alterar Senha
                            </Button>
                            {admin.usuario !== "admin" && (
                              <Button onClick={() => excluirAdmin(admin.usuario)} variant="destructive" size="sm">
                                🗑️ Excluir
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {paginaAtual === "vendas" && adminLogado && adminLogado.permissoes.registrarVendas && (
          <Card className="backdrop-blur-sm bg-white/90">
            <CardHeader>
              <CardTitle className="text-green-700">💰 Registrar Vendas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium mb-2">Quantidade Vendida (unidades)</label>
                    <input
                      type="number"
                      min="1"
                      value={novaVenda.quantidade}
                      onChange={(e) => setNovaVenda({ ...novaVenda, quantidade: Number.parseInt(e.target.value) || 0 })}
                      className="w-full p-3 border rounded-lg text-lg"
                      placeholder="Ex: 50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Valor Total da Venda (R$)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={novaVenda.valorTotal}
                      onChange={(e) =>
                        setNovaVenda({ ...novaVenda, valorTotal: Number.parseFloat(e.target.value) || 0 })
                      }
                      className="w-full p-3 border rounded-lg text-lg"
                      placeholder="Ex: 150.00"
                    />
                  </div>
                </div>

                {novaVenda.quantidade > 0 && novaVenda.valorTotal > 0 && (
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <h3 className="font-semibold text-blue-800 mb-2">📊 Resumo da Venda</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Quantidade:</span>
                        <div className="font-semibold">{novaVenda.quantidade} unidades</div>
                      </div>
                      <div>
                        <span className="text-gray-600">Valor Total:</span>
                        <div className="font-semibold">R$ {novaVenda.valorTotal.toFixed(2)}</div>
                      </div>
                      <div>
                        <span className="text-gray-600">Preço por unidade:</span>
                        <div className="font-semibold">
                          R$ {(novaVenda.valorTotal / novaVenda.quantidade).toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-600">Vendedor:</span>
                        <div className="font-semibold">{adminLogado.usuario}</div>
                      </div>
                    </div>
                  </div>
                )}

                <Button
                  onClick={registrarVenda}
                  disabled={novaVenda.quantidade <= 0 || novaVenda.valorTotal <= 0}
                  className="w-full bg-green-600 hover:bg-green-700 text-lg py-3"
                >
                  💾 Registrar Venda
                </Button>

                {mensagemVenda && <div className="p-3 bg-green-100 text-green-800 rounded-lg">{mensagemVenda}</div>}
              </div>
            </CardContent>
          </Card>
        )}

        {paginaAtual === "vendas" && (!adminLogado || !adminLogado.permissoes.registrarVendas) && (
          <Card className="backdrop-blur-sm bg-white/90">
            <CardContent className="text-center py-12">
              <div className="text-6xl mb-4">🔒</div>
              <h2 className="text-xl font-semibold text-gray-700 mb-2">Acesso Restrito</h2>
              <p className="text-gray-600">
                Você precisa estar logado como administrador com permissão para registrar vendas.
              </p>
            </CardContent>
          </Card>
        )}

        {paginaAtual === "relatorios" &&
          adminLogado &&
          (adminLogado.permissoes.registrarVendas || adminLogado.permissoes.gerenteVendas) && (
            <Card className="backdrop-blur-sm bg-white/90">
              <CardHeader>
                <CardTitle className="text-blue-700">
                  📊 Relatório de Vendas
                  {adminLogado.permissoes.gerenteVendas && (
                    <span className="text-sm font-normal text-green-600 ml-2">(Gerente - Todas as vendas)</span>
                  )}
                  {adminLogado.permissoes.registrarVendas && !adminLogado.permissoes.gerenteVendas && (
                    <span className="text-sm font-normal text-blue-600 ml-2">(Vendedor - Suas vendas)</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-green-50 rounded-lg">
                      <div className="text-2xl font-bold text-green-700">
                        {calcularEstatisticasFiltradas().totalVendas}
                      </div>
                      <div className="text-sm text-gray-600">Total de Vendas</div>
                    </div>
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <div className="text-2xl font-bold text-blue-700">
                        {calcularEstatisticasFiltradas().quantidadeTotal}
                      </div>
                      <div className="text-sm text-gray-600">Unidades Vendidas</div>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg">
                      <div className="text-2xl font-bold text-purple-700">
                        R$ {calcularEstatisticasFiltradas().valorTotal.toFixed(2)}
                      </div>
                      <div className="text-sm text-gray-600">Valor Total</div>
                    </div>
                  </div>

                  {/* Histórico de Vendas */}
                  <div>
                    <h3 className="font-semibold mb-4">📋 Histórico de Vendas</h3>
                    {obterVendasFiltradas().length === 0 ? (
                      <div className="text-center py-8 text-gray-500">Nenhuma venda registrada ainda.</div>
                    ) : (
                      <div className="space-y-3">
                        {obterVendasFiltradas().map((venda) => (
                          <div key={venda.id} className="p-4 border rounded-lg bg-white">
                            <div className="flex justify-between items-start">
                              <div>
                                <div className="font-semibold">Venda #{venda.id}</div>
                                <div className="text-sm text-gray-600">
                                  {new Date(venda.dataHora).toLocaleString("pt-BR")}
                                </div>
                                <div className="text-sm text-gray-600">Vendedor: {venda.usuario}</div>
                              </div>
                              <div className="text-right">
                                <div className="font-semibold">{venda.quantidade} unidades</div>
                                <div className="text-lg font-bold text-green-600">R$ {venda.valorTotal.toFixed(2)}</div>
                                <div className="text-sm text-gray-600">
                                  R$ {(venda.valorTotal / venda.quantidade).toFixed(2)}/unidade
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

        {paginaAtual === "relatorios" &&
          (!adminLogado || (!adminLogado.permissoes.registrarVendas && !adminLogado.permissoes.gerenteVendas)) && (
            <Card className="backdrop-blur-sm bg-white/90">
              <CardContent className="text-center py-12">
                <div className="text-6xl mb-4">🔒</div>
                <h2 className="text-xl font-semibold text-gray-700 mb-2">Acesso Restrito</h2>
                <p className="text-gray-600">
                  Você precisa estar logado como administrador com permissão para ver relatórios de vendas.
                </p>
              </CardContent>
            </Card>
          )}
      </div>
    </div>
  )
}
