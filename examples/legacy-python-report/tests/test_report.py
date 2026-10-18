import unittest
from report import sort_versions, latest_version, render_report


class ReleaseReportTests(unittest.TestCase):
    def test_numeric_version_order(self):
        self.assertEqual(sort_versions(["1.10.0", "1.2.0"]), ["1.2.0", "1.10.0"])

    def test_preserves_input(self):
        versions = ["2.0.0", "1.0.0"]
        sort_versions(versions)
        self.assertEqual(versions, ["2.0.0", "1.0.0"])

    def test_latest_version(self):
        self.assertEqual(latest_version(["1.9.0", "1.10.0", "1.2.0"]), "1.10.0")

    def test_empty_input(self):
        with self.assertRaises(ValueError):
            latest_version([])

    def test_invalid_version(self):
        with self.assertRaises(ValueError):
            sort_versions(["not a version"])

    def test_html_escapes_title(self):
        html = render_report(["1.0.0"], "<script>bad</script>")
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;", html)


if __name__ == "__main__":
    unittest.main()
