Feature: Tagging a posted journal entry line with a cost centre
  As a module that posts to the general ledger (the Posting Rules Engine, Fixed Assets)
  I want to tag a posted line with a cost centre, replace that tag, and have undo and redo restore it
  So that a cost centre allocation stays correct, owned by one writer and scoped to one organization

  Background:
    Given a posted journal entry line in organization "A" whose fiscal period is open

  Scenario: Re-tagging a line replaces its cost centre tag
    Given the line is tagged with cost centre "CC-OLD" by "posting_rules"
    When "posting_rules" tags the line with cost centre "CC-NEW" in organization "A"
    Then the tag is accepted
    And the line carries only cost centre "CC-NEW" owned by "posting_rules"

  Scenario: A user of another organization cannot tag the line
    When "posting_rules" tags the line with cost centre "CC-B" in organization "B"
    Then the tag is rejected with status 404
    And the line carries no cost centre tag

  Scenario: Another writer cannot replace a tag it does not own
    Given the line is tagged with cost centre "CC-PR" by "posting_rules"
    When "fixed_assets" tags the line with cost centre "CC-FA" in organization "A"
    Then the tag is rejected with status 409
    And the line carries only cost centre "CC-PR" owned by "posting_rules"

  Scenario: The tag survives undo and redo
    Given the line is tagged with cost centre "CC-OLD" by "posting_rules"
    When "posting_rules" tags the line with cost centre "CC-NEW" in organization "A"
    And the tag change is undone
    Then the line carries only cost centre "CC-OLD" owned by "posting_rules"
    When the tag change is redone
    Then the line carries only cost centre "CC-NEW" owned by "posting_rules"
