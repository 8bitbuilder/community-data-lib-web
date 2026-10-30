"""Helpers for the in-browser pandas notebook (runs under Pyodide and CPython)."""
import ast
import contextlib
import io
import traceback

import pandas as pd

MAX_ROWS = 50
CELL_FILENAME = "<cell>"


def _cell(v):
    if v is None:
        return ""
    try:
        if pd.isna(v):
            return ""
    except (TypeError, ValueError):
        pass
    return str(v)


def _table(obj):
    frame = obj.to_frame() if isinstance(obj, pd.Series) else obj
    head = frame.head(MAX_ROWS)
    return {
        "columns": [str(c) for c in head.columns],
        "rows": [[_cell(v) for v in row] for row in head.itertuples(index=False, name=None)],
    }


def _error(exc):
    frames = [
        f for f in traceback.extract_tb(exc.__traceback__) if f.filename == CELL_FILENAME
    ]
    lines = ["Traceback (most recent call last):\n"]
    lines += traceback.format_list(frames)
    lines += traceback.format_exception_only(type(exc), exc)
    return {
        "name": type(exc).__name__,
        "message": str(exc),
        "traceback": "".join(lines),
    }


def run_cell(code, ns):
    buf = io.StringIO()
    out = {}
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            tree = ast.parse(code, filename=CELL_FILENAME, mode="exec")
            last = None
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last = ast.Expression(tree.body.pop().value)
            exec(compile(tree, CELL_FILENAME, "exec"), ns)
            if last is not None:
                value = eval(compile(last, CELL_FILENAME, "eval"), ns)
                if isinstance(value, (pd.DataFrame, pd.Series)):
                    out["table"] = _table(value)
                elif value is not None:
                    out["text"] = repr(value)
    except BaseException as exc:  # noqa: BLE001 - report everything to the user
        out.pop("table", None)
        out.pop("text", None)
        out["error"] = _error(exc)
    out["stdout"] = buf.getvalue()
    return out


def df_info(ns):
    df = ns.get("df")
    if not isinstance(df, pd.DataFrame):
        return None
    return {
        "rows": int(len(df)),
        "cols": int(df.shape[1]),
        "columns": [
            {
                "name": str(name),
                "dtype": str(df.dtypes.iloc[i]),
                "numeric": bool(pd.api.types.is_numeric_dtype(df.dtypes.iloc[i]))
                and not pd.api.types.is_bool_dtype(df.dtypes.iloc[i]),
                "missing": int(df.iloc[:, i].isna().sum()),
            }
            for i, name in enumerate(df.columns)
        ],
        "head": _table(df),
    }


def export_df(ns, fmt):
    df = ns.get("df")
    if not isinstance(df, pd.DataFrame):
        raise ValueError("No DataFrame named df to export")
    if fmt == "csv":
        return df.to_csv(index=False).encode("utf-8")
    if fmt == "xlsx":
        buf = io.BytesIO()
        df.to_excel(buf, index=False)
        return buf.getvalue()
    raise ValueError("Unknown format: " + str(fmt))
