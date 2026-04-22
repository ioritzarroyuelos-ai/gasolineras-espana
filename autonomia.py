"""Calculadora de autonomia de un coche.

Lee por consola el tipo de coche (combustion/electrico), la capacidad
disponible (litros o kWh) y el consumo medio (L/100km o kWh/100km),
valida que los valores numericos sean positivos, y muestra la autonomia
resultante en kilometros con 1 decimal.

Formula:
    autonomia = (capacidad_disponible / consumo_medio) * 100

Ejecucion:
    python autonomia.py
"""


def pedir_tipo() -> str:
    """Pide el tipo de coche, repite hasta que sea 'combustion' o 'electrico'."""
    while True:
        tipo = input("Tipo de coche (combustion/electrico): ").strip().lower()
        if tipo in ("combustion", "electrico"):
            return tipo
        print("  Error: introduce 'combustion' o 'electrico'.")


def pedir_positivo(mensaje: str) -> float:
    """Pide un numero por consola y valida que sea float positivo.

    Acepta coma o punto como separador decimal (p.ej. '5,8' o '5.8').
    """
    while True:
        raw = input(mensaje).strip().replace(",", ".")
        try:
            valor = float(raw)
        except ValueError:
            print("  Error: debe ser un numero (ej: 45 o 5.8).")
            continue
        if valor <= 0:
            print("  Error: el valor debe ser positivo (> 0).")
            continue
        return valor


def main() -> None:
    print("=== Autonomia de tu coche ===")

    tipo = pedir_tipo()

    if tipo == "combustion":
        label_cap = "Capacidad disponible (litros): "
        label_cons = "Consumo medio (L/100km): "
        unidad_cap = "L"
        unidad_cons = "L/100km"
    else:  # electrico
        label_cap = "Capacidad disponible (kWh): "
        label_cons = "Consumo medio (kWh/100km): "
        unidad_cap = "kWh"
        unidad_cons = "kWh/100km"

    capacidad = pedir_positivo(label_cap)
    consumo = pedir_positivo(label_cons)

    autonomia = (capacidad / consumo) * 100

    print()
    print("--- Resultado ---")
    print(f"  Tipo:      {tipo}")
    print(f"  Capacidad: {capacidad:g} {unidad_cap}")
    print(f"  Consumo:   {consumo:g} {unidad_cons}")
    print(f"  Autonomia: {autonomia:.1f} km")


if __name__ == "__main__":
    main()
