import importlib.util
import json
import unittest
from io import BytesIO
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "cdl_helpers", ROOT / "src/components/notebook/helpers.py"
)
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

SETUP = "import pandas as pd\ndf = pd.DataFrame({'a': [1, 2, None], 'b': ['x', 'y', 'z']})"


class HelpersTest(unittest.TestCase):
    def test_last_expression_dataframe_returns_table(self):
        ns = {}
        h.run_cell(SETUP, ns)
        out = h.run_cell("df", ns)
        self.assertEqual(out["stdout"], "")
        self.assertEqual(out["table"]["columns"], ["", "a", "b"])
        self.assertEqual(
            out["table"]["rows"], [["0", "1.0", "x"], ["1", "2.0", "y"], ["2", "", "z"]]
        )

    def test_series_result_shows_index_labels(self):
        ns = {}
        h.run_cell("import pandas as pd\ndf = pd.DataFrame({'A': ['p', 'q', 'p']})", ns)
        t = h.run_cell("df['A'].value_counts()", ns)["table"]
        self.assertEqual(t["columns"][0], "A")
        self.assertEqual(sorted(r[0] for r in t["rows"]), ["p", "q"])

    def test_describe_shows_stat_labels(self):
        ns = {}
        h.run_cell(SETUP, ns)
        t = h.run_cell("df.describe()", ns)["table"]
        self.assertEqual(t["columns"], ["", "a"])
        self.assertEqual(t["rows"][0][0], "count")

    def test_multiindex_labels_joined(self):
        ns = {}
        out = h.run_cell(
            "import pandas as pd\n"
            "pd.DataFrame({'v': [1, 2]}, index=pd.MultiIndex.from_tuples([('a', 1), ('b', 2)], names=['k', 'n']))",
            ns,
        )
        self.assertEqual(out["table"]["columns"], ["k, n", "v"])
        self.assertEqual(out["table"]["rows"][0], ["a, 1", "1"])

    def test_syntax_error_reported(self):
        out = h.run_cell("def (", {})
        self.assertEqual(out["error"]["name"], "SyntaxError")
        self.assertEqual(out["stdout"], "")

    def test_stdout_kept_with_error(self):
        out = h.run_cell("print('before')\n1/0", {})
        self.assertEqual(out["stdout"], "before\n")
        self.assertEqual(out["error"]["name"], "ZeroDivisionError")

    def test_variables_persist_and_non_table_text(self):
        ns = {}
        h.run_cell("x = 2", ns)
        self.assertEqual(h.run_cell("x + 1", ns)["text"], "3")
        self.assertNotIn("text", h.run_cell("x = 5", ns))

    def test_print_is_captured(self):
        out = h.run_cell("print('hi')", {})
        self.assertEqual(out["stdout"], "hi\n")
        self.assertNotIn("error", out)

    def test_error_has_name_message_and_cell_traceback(self):
        ns = {}
        h.run_cell(SETUP, ns)
        out = h.run_cell("df['nope']", ns)
        err = out["error"]
        self.assertEqual(err["name"], "KeyError")
        self.assertIn("nope", err["message"])
        self.assertIn("<cell>", err["traceback"])
        self.assertNotIn("cdl_helpers", err["traceback"])
        self.assertNotIn("helpers.py", err["traceback"])

    def test_df_info_counts_missing_and_numeric(self):
        ns = {}
        h.run_cell(SETUP, ns)
        info = h.df_info(ns)
        self.assertEqual((info["rows"], info["cols"]), (3, 2))
        a, b = info["columns"]
        self.assertEqual((a["name"], a["numeric"], a["missing"]), ("a", True, 1))
        self.assertEqual((b["name"], b["numeric"], b["missing"]), ("b", False, 0))
        self.assertIsInstance(a["dtype"], str)
        self.assertEqual(info["head"]["columns"], ["", "a", "b"])
        self.assertEqual([r[0] for r in info["head"]["rows"]], ["0", "1", "2"])
        self.assertEqual(len(info["head"]["rows"]), 3)

    def test_df_info_none_without_df(self):
        self.assertIsNone(h.df_info({}))
        self.assertIsNone(h.df_info({"df": 5}))

    def test_export_csv_and_xlsx_round_trip(self):
        ns = {}
        h.run_cell(SETUP, ns)
        csv = h.export_df(ns, "csv")
        self.assertIsInstance(csv, bytes)
        back = pd.read_csv(BytesIO(csv))
        self.assertEqual(list(back.columns), ["a", "b"])
        self.assertEqual(len(back), 3)
        xl = h.export_df(ns, "xlsx")
        back = pd.read_excel(BytesIO(xl))
        self.assertEqual(list(back.columns), ["a", "b"])
        self.assertEqual(len(back), 3)

    def test_pandas_matches_js_loader_on_fixtures(self):
        fx = ROOT / "tests/fixtures"
        expected = json.loads((fx / "expected.json").read_text())
        for name, e in expected.items():
            with self.subTest(name):
                if name.endswith(".xls"):
                    try:
                        import xlrd  # noqa: F401
                    except ImportError:
                        self.skipTest("xlrd not installed; skipping " + name)
                df = pd.read_excel(
                    fx / name,
                    sheet_name=e["sheet"],
                    skiprows=e["headerRow"] - 1 or None,
                    nrows=e["dataRowCount"],
                )
                df.columns = df.columns.astype(str)
                self.assertEqual(list(df.columns), e["headers"])
                self.assertEqual(len(df), e["rowCount"])


if __name__ == "__main__":
    unittest.main()
